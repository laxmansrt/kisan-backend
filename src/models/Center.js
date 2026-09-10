'use strict';
const mongoose = require('mongoose');

const centerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: { type: String, required: true },
  latitude: { type: Number },
  longitude: { type: Number },
  daily_capacity_quintals: { type: Number, required: true, default: 500 },
  daily_farmer_capacity: { type: Number, required: true, default: 100 },
  address: { type: String },
  contact_number: { type: String },
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

module.exports = mongoose.models.Center || mongoose.model('Center', centerSchema);
