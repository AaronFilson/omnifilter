process.env.MONGOLAB_URI = 'mongodb://localhost/user_routes_test';
require(__dirname + '/../server');
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.use(chaiHttp);
const expect = chai.expect;
const request = chai.request;
const mongoose = require('mongoose');

const User = require(__dirname + '/../models/user');
var userToken;
var testUser;

describe('user API', () => {

  before((done) => {
    testUser = new User();
    testUser.email = 'gene@gmail.com';
    testUser.hashPassword('password');
    testUser.save( (err, data) => {
      if (err) throw err;
      testUser.token = userToken = data.generateToken();
      done();
    });
  });

  after((done) => {
    mongoose.connection.db.dropDatabase(() => {
      done();
    });
  });

  describe('check if user exists', () => {
    it('should be able to verify that a user exists', (done) => {
      request('localhost:3000')
        .get('/verify/')
        .set('token', userToken)
        .end((err, res) => {
          expect(err).to.eql(null);
          expect(res.body).to.not.eql(null);
          expect(res.body.msg).to.eql('User verified');
          done();
        });
    });
  });

  describe('ability to UPDATE and DELETE', () => {
    it('should be able to UPDATE a user', (done) => {
      request('localhost:3000')
        .put('/usersettings/' + testUser._id)
        .set('token', userToken)
        .send({ email: 'new email' })
        .end(function(err, res) {
          expect(err).to.eql(null);
          expect(res.body.msg).to.eql('User updated');
          expect(res).to.have.status(200);
          done();
        });
    });

    it('should be able to DELETE a user', (done) => {
      request('localhost:3000')
        .delete('/deleteuser/' + testUser._id)
        .set('token', userToken)
        .end((err, res) => {
          expect(err).to.eql(null);
          expect(res.body.msg).to.eql('User deleted');
          expect(res).to.have.status(200);
          done();
        });
    });
  });
});
