'use strict';
const mongoose = require('mongoose');

const farmerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  mobile_number: { type: String, required: true, unique: true, index: true },
  village: { type: String },
  location: { type: String },
  language_preference: { type: String, default: 'en' },
  password_hash: { type: String },
  pattern_hash: { type: String },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id ? ret._id.toString() : ret.id;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id ? ret._id.toString() : ret.id;
      return ret;
    },
  },
});

module.exports = mongoose.models.Farmer || mongoose.model('Farmer', farmerSchema);
