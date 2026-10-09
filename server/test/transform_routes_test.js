require(__dirname + '/../server.js');
const { clearCollections } = require(__dirname + '/setup');
const User = require(__dirname + '/../models/user');
const imageCodec = require(__dirname + '/../lib/image_codec');
const ref = require(__dirname + '/reference');
const sharp = require('sharp');
var PORT = process.env.PORT || process.env.$PORT || 3000;
var baseUri = 'localhost:' + PORT;

var chai = require('chai');
var chaiHTTP = require('chai-http');
chai.use(chaiHTTP);
var mongoose = require('mongoose');
var expect = chai.expect;

// A gradient with a hard edge in the middle, so blur and sharpen both change it.
function testImage(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = x < width / 2 ? 30 : 220;
      data[o + 1] = Math.floor(255 * y / height);
      data[o + 2] = 128;
      data[o + 3] = 255;
    }
  }
  return data;
}

function encode(format, data, width, height) {
  return sharp(Buffer.from(data), { raw: { width: width, height: height, channels: 4 } })
    .toFormat(format, { quality: 95 })
    .toBuffer()
    .then((bytes) => 'data:image/' + format + ';base64,' + bytes.toString('base64'));
}

describe('image codec', () => {
  it('round-trips a PNG exactly, including alpha', () => {
    // Fully transparent pixels may lose their colour, so keep alpha above 0.
    const pixels = Buffer.from(ref.randomImage(5, 3, 9).map((v, i) => (i % 4 === 3 ? Math.max(v, 1) : v)));
    return encode('png', pixels, 5, 3)
      .then((dataUrl) => imageCodec.decodeDataUrl(dataUrl))
      .then((image) => {
        expect([image.mime, image.width, image.height]).to.eql(['image/png', 5, 3]);
        expect(image.data).to.eql(pixels);
        return imageCodec.encodeDataUrl(image);
      })
      .then((dataUrl) => imageCodec.decodeDataUrl(dataUrl))
      .then((image) => expect(image.data).to.eql(pixels));
  });

  it('decodes other formats and saves them as PNG', () => {
    return encode('webp', testImage(8, 8), 8, 8)
      .then((dataUrl) => imageCodec.decodeDataUrl(dataUrl))
      .then((image) => {
        expect([image.mime, image.width, image.height]).to.eql(['image/png', 8, 8]);
        expect(image.data.length).to.eql(8 * 8 * 4);
      });
  });

  it('applies the EXIF orientation', () => {
    // A 4x2 image tagged "rotate 90 degrees" should come out 2x4.
    return sharp(testImage(4, 2), { raw: { width: 4, height: 2, channels: 4 } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer()
      .then((bytes) => imageCodec.decodeDataUrl('data:image/jpeg;base64,' + bytes.toString('base64')))
      .then((image) => expect([image.width, image.height]).to.eql([2, 4]));
  });

  ['not a data url', 'data:text/plain;base64,aGk=', 'data:image/jpeg;base64,bm90IGFuIGltYWdl']
    .forEach((bad) => {
      it('rejects ' + bad.slice(0, 24), () => {
        return imageCodec.decodeDataUrl(bad).then(
          () => { throw new Error('should have rejected'); },
          (err) => expect(err.message).to.match(/image/));
      });
    });
});

describe('GET /device', () => {
  it('names the device the filters run on', () => {
    return chai.request(baseUri).get('/device').then((res) => {
      expect(res).to.have.status(200);
      expect(res.body.name).to.be.a('string').that.is.not.empty;
      expect(['gpu', 'cpu', 'accelerator', 'other']).to.include(res.body.type);
    });
  });
});

describe('GET /filters', () => {
  it('lists the filters with their groups and parameters', (done) => {
    chai.request(baseUri)
      .get('/filters')
      .end((err, res) => {
        expect(err).to.eql(null);
        expect(res).to.have.status(200);
        const blur = res.body.find((f) => f.name === 'blur');
        expect(blur.group).to.equal('Blur & sharpen');
        expect(blur.params[0]).to.include({ name: 'radius', type: 'range' });
        expect(res.body.every((f) => !('plan' in f) && !('run' in f))).to.equal(true);
        done();
      });
  });
});

describe('POST /newcontent with a transformation', function() {
  this.timeout(20000);
  var userToken;
  const width = 120;
  const height = 80;
  const original = testImage(width, height);
  var jpegUrl;

  before(() => {
    var user = new User();
    user.email = 'gpu@tester.com';
    user.hashPassword('password');
    return Promise.all([
      user.save().then((data) => {
        userToken = data.generateToken();
      }),
      encode('jpeg', original, width, height).then((dataUrl) => {
        jpegUrl = dataUrl;
      })
    ]);
  });

  after(() => clearCollections());

  ['blur', 'sharpen', 'cartoon', 'stained_glass'].forEach((tOption) => {
    it('applies ' + tOption + ' and returns a JPEG', (done) => {
      chai.request(baseUri)
        .post('/newcontent')
        .set({ token: userToken })
        .send({ content: jpegUrl, tOption: tOption })
        .end((err, res) => {
          expect(err).to.eql(null);
          expect(res).to.have.status(200);
          expect(res.body.tOption).to.eql(tOption);
          expect(res.body.content).to.match(/^data:image\/jpeg;base64,/);
          imageCodec.decodeDataUrl(res.body.content).then((result) => {
            expect([result.width, result.height]).to.eql([width, height]);
            // The filter must actually have changed the picture.
            expect(ref.compare(result.data, original).max).to.be.above(20);
            done();
          }).catch(done);
        });
    });
  });

  it('uses and stores the parameters, clamped to their ranges', (done) => {
    chai.request(baseUri)
      .post('/newcontent')
      .set({ token: userToken })
      .send({ content: jpegUrl, tOption: 'pixelate', params: { block: 500, extra: 'ignored' } })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.tParams).to.eql({ block: 10 });
        done();
      });
  });

  it('rejects an unknown transformation', (done) => {
    chai.request(baseUri)
      .post('/newcontent')
      .set({ token: userToken })
      .send({ content: jpegUrl, tOption: 'explode' })
      .end((err, res) => {
        expect(res).to.have.status(400);
        expect(res.body.msg).to.match(/Unknown transformation/);
        done();
      });
  });

  it('rejects an image type it cannot decode', (done) => {
    chai.request(baseUri)
      .post('/newcontent')
      .set({ token: userToken })
      .send({ content: 'data:image/gif;base64,bm90IGFuIGltYWdl', tOption: 'blur' })
      .end((err, res) => {
        expect(res).to.have.status(400);
        expect(res.body.msg).to.match(/Could not read the image/);
        done();
      });
  });
});
