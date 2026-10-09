const express = require('express');
const User = require(__dirname + '/../models/user');
const jsonParser = require('body-parser').json();
const handleDBError = require(__dirname + '/../lib/handle_db_error');
const basicHTTP = require(__dirname + '/../lib/basic_http');

const authRouter = module.exports = exports = express.Router();

const DUPLICATE_KEY = 11000;

authRouter.post('/signup', jsonParser, (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;

  if (email.length < 5) {
    return res.status(400).json({ msg: 'Please enter an email' });
  }

  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400)
      .json({ msg: 'Please enter a password longer than 7 characters' });
  }

  var newUser = new User();
  newUser.email = email;
  newUser.hashPassword(password);
  newUser.save()
    .then((data) => res.status(200).json({ token: data.generateToken(), email: newUser.email }))
    .catch((err) => {
      if (err.code === DUPLICATE_KEY) {
        return res.status(409).json({ msg: 'An account with that email already exists' });
      }
      handleDBError(err, res);
    });
});

authRouter.get('/signin', basicHTTP, (req, res) => {
  // The same answer for an unknown email and a wrong password, so the sign-in
  // form can't be used to find out who has an account.
  const failed = () => res.status(401).json({ msg: 'incorrect email or password' });

  User.findOne({ email: req.basicHTTP.email.trim().toLowerCase() }).then((user) => {
    if (!user || !user.comparePassword(req.basicHTTP.password)) return failed();
    res.json({ msg: 'Success in signin', token: user.generateToken(), email: user.email });
  }).catch((err) => handleDBError(err, res));
});
