const express = require('express');
const jsonParser = require('body-parser').json();
const mongoose = require('mongoose');

const basicHTTP = require(__dirname + '/../lib/basic_http');
const jwtAuth = require(__dirname + '/../lib/jwt_auth');

const User = require(__dirname + '/../models/user');

const tokenFilter = (req, res, next) => {
  console.log('in tokenFilter function');
  if (!req.headers.token) return res.status(200).json({ msg: 'No token yet, so there is no email to find. Goodbye.' });
  next();
};

var userRouter = module.exports = exports = express.Router();

userRouter.get('/verify', tokenFilter, jwtAuth, (req, res) => {

  console.log('in verify function, and we have req.user.id : ' + req.user.id);
  User.findOne({
    _id: req.user.id
    }, (err, data) => {
      if (err) {
        console.log('error in verify after sending id to db');
        return res.status(500).json({
          msg: 'Error finding user'
        });
      }

      debugger;

      res.status(200).json({
        msg: 'User verified',
        email: data.email
      });
  });
});

userRouter.put('/usersettings/:id', jwtAuth, jsonParser, (req, res) => {
  var updateUser = req.body;
  delete updateUser._id;
  User.update({
    _id: req.params.id
  }, updateUser, (err) => {
    if (err) {
      return res.status(500).json({
        msg: 'Error updating user'
      });
    }
    res.status(200).json({
      msg: 'User updated'
    });
  });
});

userRouter.delete('/deleteuser/:id', jwtAuth, (req, res) => {
  User.remove({
    _id: req.params.id
  }, (err) => {
    if (err) {
      return res.status(500).json({
        msg: 'Error deleting user'
      });
    }
    res.status(200).json({
      msg: 'User deleted'
    });
  });
});
