require(__dirname + '/../server.js');
const { clearCollections } = require(__dirname + '/setup');
const User = require(__dirname + '/../models/user');
const Content = require(__dirname + '/../models/content');
const secret = require(__dirname + '/../lib/secret');
const imageCodec = require(__dirname + '/../lib/image_codec');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
var PORT = process.env.PORT || process.env.$PORT || 3000;
var baseUri = 'localhost:' + PORT;

var chai = require('chai');
var chaiHTTP = require('chai-http');
chai.use(chaiHTTP);
var expect = chai.expect;

function makeUser(email, password) {
  const user = new User();
  user.email = email;
  user.hashPassword(password);
  return user.save();
}

const pngDataUrl = (width, height) =>
  sharp({ create: { width: width, height: height, channels: 3, background: '#000' } })
    .png().toBuffer().then((bytes) => 'data:image/png;base64,' + bytes.toString('base64'));

describe('security', () => {
  var alice;
  var aliceToken;
  var bob;
  var bobToken;

  beforeEach(() => clearCollections()
    .then(() => User.syncIndexes())
    .then(() => Promise.all([makeUser('alice@tester.com', 'password1'), makeUser('bob@tester.com', 'password2')]))
    .then((users) => {
      alice = users[0];
      bob = users[1];
      aliceToken = alice.generateToken();
      bobToken = bob.generateToken();
    }));

  after(() => clearCollections());

  describe('crafted requests', () => {
    it('rejects a non-string tOption instead of crashing', () => {
      return chai.request(baseUri).post('/newcontent').set({ token: aliceToken })
        .send({ content: 'data:image/png;base64,AAAA', tOption: { toString: 1 } })
        .then((res) => {
          expect(res).to.have.status(400);
          return chai.request(baseUri).get('/filters');
        })
        .then((res) => expect(res).to.have.status(200));
    });

    it('ignores parameter values that are objects', () => {
      return pngDataUrl(4, 4).then((content) => chai.request(baseUri).post('/newcontent')
        .set({ token: aliceToken })
        .send({ content: content, tOption: 'blur', params: { radius: { toString: 1 } } }))
        .then((res) => {
          expect(res).to.have.status(200);
          expect(res.body.tParams.radius).to.be.a('number');
        });
    });

    it('refuses to save something that is not an image', () => {
      return chai.request(baseUri).post('/newcontent').set({ token: aliceToken })
        .send({ content: 'javascript:alert(1)' })
        .then((res) => expect(res).to.have.status(400));
    });

    it('answers a malformed JSON body with JSON, not a stack trace', () => {
      return chai.request(baseUri).post('/signup').set('content-type', 'application/json')
        .send('{"email":')
        .then((res) => {
          expect(res).to.have.status(400);
          expect(res.body).to.have.property('msg');
          expect(res.text).to.not.include('at ');
        });
    });
  });

  describe('login tokens', () => {
    it('rejects a token carrying a query operator as the user id', () => {
      const forged = jwt.sign({ id: { $ne: null } }, secret);
      return chai.request(baseUri).get('/getAll').set({ token: forged })
        .then((res) => expect(res).to.have.status(401));
    });

    it('rejects a token signed with the old default secret', () => {
      const forged = jwt.sign({ id: String(alice._id) }, 'changethis');
      return chai.request(baseUri).get('/getAll').set({ token: forged })
        .then((res) => expect(res).to.have.status(401));
    });

    it('rejects an unsigned token', () => {
      const unsigned = jwt.sign({ id: String(alice._id) }, null, { algorithm: 'none' });
      return chai.request(baseUri).get('/getAll').set({ token: unsigned })
        .then((res) => expect(res).to.have.status(401));
    });

    it('rejects an expired token', () => {
      const expired = jwt.sign({ id: String(alice._id), exp: Math.floor(Date.now() / 1000) - 10 }, secret);
      return chai.request(baseUri).get('/getAll').set({ token: expired })
        .then((res) => expect(res).to.have.status(401));
    });

    it('gives tokens an expiry', () => {
      const decoded = jwt.decode(aliceToken);
      expect(decoded.exp - decoded.iat).to.eql(7 * 24 * 60 * 60);
    });
  });

  describe('photos belong to their owner', () => {
    var photo;
    beforeEach(() => Content.create({ user_id: alice._id, content: 'data:image/png;base64,AAAA', title: 'mine' })
      .then((data) => { photo = data; }));

    it('does not let another user update a photo', () => {
      return chai.request(baseUri).put('/preview/' + photo._id).set({ token: bobToken })
        .send({ title: 'stolen' })
        .then((res) => {
          expect(res).to.have.status(404);
          return Content.findById(photo._id);
        })
        .then((saved) => expect(saved.title).to.eql('mine'));
    });

    it('does not let another user delete a photo', () => {
      return chai.request(baseUri).delete('/delete/' + photo._id).set({ token: bobToken })
        .then((res) => {
          expect(res).to.have.status(404);
          return Content.findById(photo._id);
        })
        .then((saved) => expect(saved).to.not.eql(null));
    });

    it('does not show one user the photos of another', () => {
      return chai.request(baseUri).get('/getAll').set({ token: bobToken })
        .then((res) => expect(res.body).to.eql([]));
    });

    it('ignores operators and protected fields in an update', () => {
      return chai.request(baseUri).put('/preview/' + photo._id).set({ token: aliceToken })
        .send({ $set: { user_id: String(bob._id) }, user_id: String(bob._id), title: 'renamed' })
        .then((res) => {
          expect(res).to.have.status(200);
          return Content.findById(photo._id);
        })
        .then((saved) => {
          expect(saved.user_id).to.eql(String(alice._id));
          expect(saved.title).to.eql('renamed');
        });
    });

    it('rejects a field of the wrong type', () => {
      return chai.request(baseUri).put('/preview/' + photo._id).set({ token: aliceToken })
        .send({ title: { $gt: '' } })
        .then((res) => expect(res).to.have.status(400));
    });

    it('answers 404 for an id that is not an id', () => {
      return chai.request(baseUri).delete('/delete/not-an-id').set({ token: aliceToken })
        .then((res) => expect(res).to.have.status(404));
    });
  });

  describe('accounts', () => {
    it('does not allow two accounts with the same email, in any case', () => {
      return chai.request(baseUri).post('/signup').send({ email: 'Alice@Tester.com ', password: 'password9' })
        .then((res) => expect(res).to.have.status(409));
    });

    it('signs in with a password containing a colon', () => {
      return makeUser('colon@tester.com', 'pass:word:1')
        .then(() => chai.request(baseUri).get('/signin').auth('colon@tester.com', 'pass:word:1'))
        .then((res) => expect(res).to.have.status(200));
    });

    it('gives the same answer for an unknown email and a wrong password', () => {
      return Promise.all([
        chai.request(baseUri).get('/signin').auth('nobody@tester.com', 'password1'),
        chai.request(baseUri).get('/signin').auth('alice@tester.com', 'wrongpassword')
      ]).then((results) => {
        expect(results[0]).to.have.status(401);
        expect(results[0].body).to.eql(results[1].body);
      });
    });

    it('ignores operators in a settings update', () => {
      return chai.request(baseUri).put('/usersettings/' + alice._id).set({ token: aliceToken })
        .send({ $set: { email: 'hijacked@tester.com' } })
        .then((res) => {
          expect(res).to.have.status(400);
          return User.findById(alice._id);
        })
        .then((saved) => expect(saved.email).to.eql('alice@tester.com'));
    });

    it('needs the current password to change the password', () => {
      return chai.request(baseUri).put('/usersettings/' + alice._id).set({ token: aliceToken })
        .send({ password: 'newpassword' })
        .then((res) => expect(res).to.have.status(403));
    });

    it('does not let one user change another user\'s account', () => {
      return chai.request(baseUri).put('/usersettings/' + alice._id).set({ token: bobToken })
        .send({ email: 'bob2@tester.com', currentPassword: 'password2' })
        .then((res) => expect(res).to.have.status(403));
    });

    it('signs out old sessions when the password changes', function() {
      // Tokens record their issue time in whole seconds.
      this.timeout(5000);
      var newToken;
      return new Promise((resolve) => setTimeout(resolve, 1100))
        .then(() => chai.request(baseUri).put('/usersettings/' + alice._id).set({ token: aliceToken })
          .send({ password: 'newpassword', currentPassword: 'password1' }))
        .then((res) => {
          expect(res).to.have.status(200);
          newToken = res.body.token;
          return chai.request(baseUri).get('/getAll').set({ token: aliceToken });
        })
        .then((res) => {
          expect(res).to.have.status(401);
          return chai.request(baseUri).get('/getAll').set({ token: newToken });
        })
        .then((res) => expect(res).to.have.status(200));
    });

    it('deletes a user\'s photos along with the account', () => {
      return Content.create({ user_id: alice._id, content: 'data:image/png;base64,AAAA' })
        .then(() => chai.request(baseUri).delete('/deleteuser/' + alice._id).set({ token: aliceToken }))
        .then((res) => {
          expect(res).to.have.status(200);
          return Content.countDocuments({ user_id: alice._id });
        })
        .then((count) => expect(count).to.eql(0));
    });
  });

  describe('image size limits', () => {
    it('refuses images over the pixel limit without decoding them', function() {
      this.timeout(20000);
      // 8000 x 8000 is 64 megapixels: a few hundred KB as a PNG, 256 MB decoded.
      return pngDataUrl(8000, 8000)
        .then((content) => {
          const start = Date.now();
          return imageCodec.decodeDataUrl(content).then(
            () => { throw new Error('should have been refused'); },
            (err) => {
              expect(err.message).to.include('megapixels');
              expect(Date.now() - start).to.be.below(1000);
            });
        });
    });

    it('refuses images wider than the GPU can texture', () => {
      return pngDataUrl(imageCodec.MAX_SIDE + 1, 1)
        .then((content) => imageCodec.decodeDataUrl(content))
        .then(() => { throw new Error('should have been refused'); },
          (err) => expect(err.message).to.include('pixels wide or tall'));
    });

    it('answers an oversized image with a 400', function() {
      this.timeout(20000);
      return pngDataUrl(8000, 8000)
        .then((content) => chai.request(baseUri).post('/newcontent').set({ token: aliceToken })
          .send({ content: content, tOption: 'invert' }))
        .then((res) => {
          expect(res).to.have.status(400);
          expect(res.body.msg).to.include('megapixels');
        });
    });
  });
});
