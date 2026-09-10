'use strict';
const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  center_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Center', required: true, index: true },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  start_time: { type: String, required: true }, // HH:MM
  end_time: { type: String, required: true }, // HH:MM
  max_farmers: { type: Number, required: true, default: 25 },
  farmers_assigned_count: { type: Number, required: true, default: 0 },
  allocated_quintals: { type: Number, required: true, default: 0 },
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

slotSchema.index({ center_id: 1, date: 1, start_time: 1 }, { unique: true });

module.exports = mongoose.models.Slot || mongoose.model('Slot', slotSchema);
