'use strict';
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  farmer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', index: true },
  registration_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CropRegistration' },
  message: { type: String, required: true },
  channel: { type: String, default: 'in-app' }, // 'in-app' | 'sms'
  read: { type: Boolean, default: false },
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

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
