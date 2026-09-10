'use strict';
const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sih26032';

let isConnected = false;

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    const conn = await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
    const dbName = mongoose.connection.name || 'sih26032';
    console.log(`🍃 Connected to MongoDB Atlas (${dbName})`);
    return mongoose.connection;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err;
  }
}

// Auto-connect on require
connectDB().catch(err => {
  console.error('Failed initial MongoDB connection:', err.message);
});

module.exports = { mongoose, connectDB };
