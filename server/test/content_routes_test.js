require(__dirname + '/../server.js');
const { clearCollections } = require(__dirname + '/setup');
const User = require(__dirname + '/../models/user');
const Content = require(__dirname + '/../models/content');
var PORT = process.env.PORT || process.env.$PORT || 3000;
var baseUri = 'localhost:' + PORT;

var chai = require('chai');
var chaiHTTP = require('chai-http');
chai.use(chaiHTTP);
var mongoose = require('mongoose');
var expect = chai.expect;

describe('content API', () => {

  var userToken;
  var userId;

  before((done) => {
    var newUser = new User();
    newUser.email = 'test2@tester.com';
    newUser.hashPassword('password2');
    newUser.save().then((data) => {
      userToken = data.generateToken();
      userId = data._id;
      done();
    }, done);
  });

  after((done) => {
    clearCollections().then(() => done(), done);
  });

  it('should be able to GET all content', (done) => {
    chai.request(baseUri)
      .get('/getAll')
      .set( { token: userToken } )
      .end((err, res) => {
        expect(err).to.eql(null);
        expect(res.body).to.not.eql(null);
        done();
      });
  });

  it('should create content with a POST', (done) => {
    chai.request(baseUri)
      .post('/newcontent')
      .set( { token: userToken } )
      .send({ content: 'data:image/png;base64,AAAA' } )
      .end(function(err, res) {
        expect(err).to.eql(null);
        expect(res).to.have.status(200);
        expect(res.body.content).to.eql('data:image/png;base64,AAAA');
        expect(res.body).to.have.property('_id');
        done();
      });
  });

  describe('rest requests that require content already in db', () => {
    beforeEach((done) => {
      Content.create( { content: 'test content', user_id: userId }).then((data) => {
        this.testContent = data;
        done();
      }, done);
    });

    it('should be able to update content', (done) => {
      chai.request(baseUri)
        .put('/preview/' + this.testContent._id)
        .set( { token: userToken } )
        .send( { title: 'new content name' } )
        .end((err, res) => {
          expect(err).to.eql(null);
          expect(res).to.have.status(200);
          expect(res.body.msg).to.eql('Successfully updated content');
          Content.findById(this.testContent._id).then((saved) => {
            expect(saved.title).to.eql('new content name');
            done();
          }, done);
        });
    });

    it('should be able to delete content', (done) => {
      chai.request(baseUri)
        .delete('/delete/' + this.testContent._id)
        .set( { token: userToken } )
        .end((err, res) => {
          expect(err).to.eql(null);
          expect(res).to.have.status(200);
          expect(res.body.msg).to.eql('Successfully deleted content');
          done();
        });
    });
  });
  describe('Error handling in preview route', () => {
    it('should correctly stop for lack of token', (done) => {
      chai.request(baseUri)
        .put('/preview/' + this.testContent._id)
        .set( { token: null } )
        .send( { name: 'new content name' } )
        .end((err, res) => {
          expect(res).to.have.status(401);
          expect(res.body.msg).to.eql('could not authenticate user');
          done();
        });
    });

    it('should correctly stop for mis-match verb', (done) => {
      chai.request(baseUri)
        .get('/preview/' + this.testContent._id)
        .set( { token: userToken } )
        .send( { name: 'new content name' } )
        .end((err, res) => {
          expect(res).to.have.status(404);
          done();
        });
    });
  });
});
