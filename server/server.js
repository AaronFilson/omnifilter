var PORT = process.env.PORT || process.env.$PORT || 3000;
var clientPort = process.env.CLIENTPORT || 5000;
var hostURL = process.env.HOSTURL || 'http://localhost:';
const express = require('express');
const app = module.exports = exports = express();
const mongoose = require('mongoose');
// Treat query values as plain values, never as operators like $ne, even if a
// route forgets to check what it was sent.
mongoose.set('sanitizeFilter', true);
mongoose.connect(process.env.MONGOLAB_URI || 'mongodb://localhost/omnifilter_app_dev')
  .catch((err) => console.log('Could not connect to MongoDB: ' + err.message));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', hostURL + clientPort);
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  next();
});

const contentRouter = require(__dirname + '/routes/content_routes');
const authRouter = require(__dirname + '/routes/auth_routes');
const userRouter = require(__dirname + '/routes/user_routes');

app.use('/', contentRouter);
app.use('/', authRouter);
app.use('/', userRouter);

// Errors passed on by the routes, including unreadable or oversized request
// bodies, get a short JSON reply instead of an HTML page with a stack trace.
app.use((err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.log('Unexpected error: ', err);
  if (res.headersSent) return next(err);
  res.status(status).json({ msg: status === 500 ? 'Server Error' : err.message });
});

try {
  const gpuFilters = require(__dirname + '/lib/gpu_filters');
  const device = gpuFilters.deviceInfo();
  for (const failure of device.skipped) console.log('Skipped OpenCL device ' + failure);
  const others = gpuFilters.devices().length - 1;
  console.log('Filters will run on ' + device.type.toUpperCase() + ': ' + device.name +
    ' (' + device.version.trim() + ', ' + device.computeUnits + ' compute units)' +
    (others ? '; ' + others + ' other OpenCL device' + (others > 1 ? 's' : '') +
      ' available, see `npm run devices`' : ''));
  const setting = (process.env.OMNIFILTER_DEVICE || 'auto').toLowerCase();
  if (device.type !== 'gpu' && (setting === 'auto' || setting === 'any')) {
    console.log('WARNING: no usable GPU was found, so filters will be slower.');
  }
} catch (e) {
  console.log('WARNING: image filters will fail: ' + e.message);
}

app.listen(PORT, () => console.log('Omnifilter backend server up on port: ' + PORT));
