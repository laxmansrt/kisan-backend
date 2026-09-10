'use strict';
const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  mobile_number: { type: String, required: true, index: true },
  otp_code: { type: String, required: true },
  expires_at: { type: Date, required: true, index: { expires: '0s' } }, // TTL index
  used: { type: Boolean, default: false },
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

module.exports = mongoose.models.Otp || mongoose.model('Otp', otpSchema);
