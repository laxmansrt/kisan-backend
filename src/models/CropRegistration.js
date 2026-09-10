'use strict';
const mongoose = require('mongoose');

const cropRegistrationSchema = new mongoose.Schema({
  farmer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
  center_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Center', required: true, index: true },
  crop_type: { type: String, required: true },
  expected_quantity: { type: Number, required: true },
  status: {
    type: String,
    enum: ['registered', 'approved', 'scheduled', 'at_center', 'procured', 'payment_processing', 'paid', 'cancelled', 'rejected'],
    default: 'registered',
    index: true,
  },
  registered_via: { type: String, default: 'self' },
  notes: { type: String },
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

module.exports = mongoose.models.CropRegistration || mongoose.model('CropRegistration', cropRegistrationSchema);
