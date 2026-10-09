const express = require('express');
const mongoose = require('mongoose');
const jsonParser = require('body-parser').json({ limit: 16000000 });
const Content = require(__dirname + '/../models/content');
const handleDBError = require(__dirname + '/../lib/handle_db_error');
const jwtAuth = require(__dirname + '/../lib/jwt_auth');
const gpuFilters = require(__dirname + '/../lib/gpu_filters');
const imageCodec = require(__dirname + '/../lib/image_codec');
const filterStack = require(__dirname + '/../lib/stack');

var contentRouter = module.exports = exports = express.Router();

// Express 4 doesn't catch errors from async handlers, and an unhandled
// rejection stops Node, so pass them on to the error handler in server.js.
const asyncRoute = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// A decoded photo takes width * height * 4 bytes (200 MB at the pixel limit)
// and the GPU runs one job at a time anyway, so only a couple of transforms
// run at once and the rest wait their turn.
const MAX_CONCURRENT_TRANSFORMS = 2;
var runningTransforms = 0;
const waitingTransforms = [];

function withTransformSlot(fn) {
  return new Promise((resolve) => {
    if (runningTransforms < MAX_CONCURRENT_TRANSFORMS) {
      runningTransforms++;
      resolve();
    } else {
      waitingTransforms.push(resolve);
    }
  }).then(fn).finally(() => {
    const next = waitingTransforms.shift();
    if (next) next(); // hand the slot straight to the next request
    else runningTransforms--;
  });
}

function msSince(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

// The fields a user may change on a saved photo, and their types.
const EDITABLE = {
  title: 'string',
  createdOn: 'string',
  location: 'string',
  tags: 'string[]'
};

function editableFields(body) {
  const update = {};
  for (const field of Object.keys(EDITABLE)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const value = body[field];
    const ok = EDITABLE[field] === 'string[]' ?
      Array.isArray(value) && value.every((v) => typeof v === 'string') :
      typeof value === 'string';
    if (!ok) return null;
    update[field] = value;
  }
  return update;
}

const validId = (req, res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(404).json({ msg: 'No such content' });
  }
  next();
};

// The available filters and their parameters, for building the UI.
contentRouter.get('/filters', (req, res) => {
  res.status(200).json(gpuFilters.list());
});

// The OpenCL device the filters run on, for the page to show.
contentRouter.get('/device', (req, res) => {
  try {
    const device = gpuFilters.deviceInfo();
    res.status(200).json({
      name: device.name,
      type: device.type,
      platform: device.platform,
      version: device.version.trim()
    });
  } catch (e) {
    res.status(503).json({ msg: 'No OpenCL device is available: ' + e.message.split('\n')[0] });
  }
});

// Ready-made filter stacks, and the controls every layer of a stack has.
contentRouter.get('/presets', (req, res) => {
  res.status(200).json({
    maxLayers: filterStack.MAX_LAYERS,
    layerParams: filterStack.LAYER_PARAMS,
    presets: filterStack.presets()
  });
});

contentRouter.get('/getlatest', jwtAuth, (req, res) => {
  Content.findOne({ user_id: req.user._id }).sort({ createdAt: -1 })
    .then((data) => res.status(200).json(data))
    .catch((err) => handleDBError(err, res));
});

contentRouter.get('/getAll', jwtAuth, (req, res) => {
  Content.find({ user_id: req.user._id }).sort({ createdAt: -1 })
    .then((data) => res.status(200).json(data))
    .catch((err) => handleDBError(err, res));
});

// Saves a photo, after applying either one filter ({ tOption, params }) or a
// stack of them ({ stack: [{ tOption, params, amount, blend }, ...] }). With
// neither, the photo is saved as it is.
contentRouter.post('/newcontent', jwtAuth, jsonParser, asyncRoute(async (req, res) => {
  const tOption = req.body.tOption || '';
  var content = req.body.content;

  if (typeof content !== 'string' || !content.length) {
    return res.status(400).json({ msg: 'No image content was sent' });
  }
  if (typeof tOption !== 'string') {
    return res.status(400).json({ msg: 'tOption must be the name of a filter' });
  }

  const isStack = req.body.stack !== undefined;
  var tParams;
  var layers = null;
  if (isStack) {
    try {
      layers = filterStack.normalizeStack(req.body.stack);
    } catch (e) {
      return res.status(400).json({ msg: e.message });
    }
  } else if (tOption) {
    if (!gpuFilters.has(tOption)) {
      return res.status(400).json({ msg: 'Unknown transformation: ' + tOption });
    }
    tParams = gpuFilters.normalizeParams(tOption, req.body.params);
    layers = [{ tOption: tOption, tParams: tParams, amount: 100, blend: 'normal' }];
  }

  if (!layers) {
    // Saved as is, so at least make sure it's an image.
    if (!imageCodec.isImageDataUrl(content)) {
      return res.status(400).json({ msg: 'Expected a base64 image data URL' });
    }
  } else {
    const failure = await withTransformSlot(async () => {
      var image;
      try {
        image = await imageCodec.decodeDataUrl(content);
      } catch (e) {
        return { status: 400, msg: 'Could not read the image: ' + e.message };
      }

      try {
        const start = process.hrtime.bigint();
        image.data = await filterStack.applyStack(layers, image.data, image.width, image.height);
        console.log('Applied ' + layers.map((l) => l.tOption).join(' + ') + ' to ' +
          image.width + 'x' + image.height + ' image in ' + msSince(start).toFixed(1) + 'ms');
      } catch (e) {
        console.log('Error in transforming the image: ', e);
        return { status: 500, msg: 'transform failure' };
      }

      try {
        content = await imageCodec.encodeDataUrl(image);
      } catch (e) {
        console.log('Error in encoding the image: ', e);
        return { status: 500, msg: 'Could not encode the transformed image' };
      }
    });
    if (failure) return res.status(failure.status).json({ msg: failure.msg });
  }

  const data = await Content.create({
    user_id: req.user._id,
    tOption: isStack ? '' : tOption,
    tParams: tParams,
    tStack: isStack ? layers : [],
    content: content
  });
  res.status(200).json(data);
}));

contentRouter.put('/preview/:id', jwtAuth, validId, jsonParser, (req, res) => {
  const update = editableFields(req.body);
  if (!update) return res.status(400).json({ msg: 'Invalid value for a photo field' });
  Content.updateOne({ _id: req.params.id, user_id: req.user._id }, { $set: update })
    .then((result) => {
      if (!result.matchedCount) return res.status(404).json({ msg: 'No such content' });
      res.status(200).json({ msg: 'Successfully updated content' });
    })
    .catch((err) => handleDBError(err, res));
});

contentRouter.delete('/delete/:id', jwtAuth, validId, (req, res) => {
  Content.deleteOne({ _id: req.params.id, user_id: req.user._id })
    .then((result) => {
      if (!result.deletedCount) return res.status(404).json({ msg: 'No such content' });
      res.status(200).json({ msg: 'Successfully deleted content' });
    })
    .catch((err) => handleDBError(err, res));
});
