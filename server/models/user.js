const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const secret = require(__dirname + '/../lib/secret');

// Logins last a week, then the user signs in again.
const TOKEN_LIFETIME = '7d';

var userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  // Tokens issued before this are rejected, so changing the password signs
  // out every other session.
  passwordChangedAt: Date
});

userSchema.methods.hashPassword = function(password) {
  var hash = this.password = bcrypt.hashSync(password, 8);
  this.passwordChangedAt = new Date();
  return hash;
};

userSchema.methods.comparePassword = function(password) {
  return typeof password === 'string' && bcrypt.compareSync(password, this.password);
};

userSchema.methods.generateToken = function() {
  return jwt.sign({ id: String(this._id) }, secret,
    { algorithm: 'HS256', expiresIn: TOKEN_LIFETIME });
};

module.exports = exports = mongoose.model('User', userSchema);
