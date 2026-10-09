const express = require('express');
const jsonParser = require('body-parser').json();
const jwtAuth = require(__dirname + '/../lib/jwt_auth');
const handleDBError = require(__dirname + '/../lib/handle_db_error');

const User = require(__dirname + '/../models/user');
const Content = require(__dirname + '/../models/content');

const DUPLICATE_KEY = 11000;

const tokenFilter = (req, res, next) => {
  if (!req.headers.token || req.headers.token === 'null') {
    return res.status(200).json({ msg: 'No token yet, so there is no email to find. Goodbye.' });
  }
  next();
};

var userRouter = module.exports = exports = express.Router();

const ownAccountOnly = (req, res, next) => {
  if (String(req.user._id) !== req.params.id) {
    return res.status(403).json({ msg: 'You can only change your own account' });
  }
  next();
};

userRouter.get('/verify', tokenFilter, jwtAuth, (req, res) => {
  res.status(200).json({
    msg: 'User verified',
    email: req.user.email,
    id: req.user.id
  });
});

// Changes the email and/or password. Both need the current password, so a
// stolen token alone can't take over the account.
userRouter.put('/usersettings/:id', jwtAuth, ownAccountOnly, jsonParser, (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  if (email !== undefined && (typeof email !== 'string' || email.trim().length < 5)) {
    return res.status(400).json({ msg: 'Please enter an email' });
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
    return res.status(400).json({ msg: 'Please enter a password longer than 7 characters' });
  }
  if (email === undefined && password === undefined) {
    return res.status(400).json({ msg: 'Nothing to update' });
  }

  User.findOne({ _id: req.user._id }).then((user) => {
    if (!user.comparePassword(req.body.currentPassword)) {
      return res.status(403).json({ msg: 'Your current password is incorrect' });
    }
    if (email !== undefined) user.email = email;
    if (password !== undefined) user.hashPassword(password);
    return user.save().then((saved) => {
      // Changing the password signs out other sessions, so hand back a new token.
      res.status(200).json({ msg: 'User updated', email: saved.email, token: saved.generateToken() });
    });
  }).catch((err) => {
    if (err.code === DUPLICATE_KEY) {
      return res.status(409).json({ msg: 'An account with that email already exists' });
    }
    handleDBError(err, res);
  });
});

userRouter.delete('/deleteuser/:id', jwtAuth, ownAccountOnly, (req, res) => {
  Content.deleteMany({ user_id: req.params.id })
    .then(() => User.deleteOne({ _id: req.params.id }))
    .then(() => {
      res.status(200).json({
        msg: 'User deleted'
      });
    }, () => {
      res.status(500).json({
        msg: 'Error deleting user'
      });
    });
});
