'use strict';
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  registration_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CropRegistration', required: true, unique: true, index: true },
  amount: { type: Number },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed'],
    default: 'pending',
    index: true,
  },
  payment_ref: { type: String },
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

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
