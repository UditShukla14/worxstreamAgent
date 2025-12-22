/**
 * MongoDB Database Connection
 */

import mongoose from 'mongoose';
import { config } from '../config/index.js';

let isConnected = false;

/**
 * Connect to MongoDB
 */
export async function connectDB() {
  if (isConnected) {
    console.log('📦 MongoDB already connected');
    return;
  }

  try {
    const mongoUrl = config.database.url;
    
    if (!mongoUrl) {
      throw new Error('MongoDB URL is not configured');
    }

    console.log('🔌 Connecting to MongoDB...');
    
    await mongoose.connect(mongoUrl, {
      // Mongoose 6+ doesn't need these options, but keeping for compatibility
    });

    isConnected = true;
    console.log('✅ MongoDB connected successfully');
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected');
      isConnected = true;
    });

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    isConnected = false;
    throw error;
  }
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectDB() {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    console.log('👋 MongoDB disconnected');
  } catch (error) {
    console.error('❌ Error disconnecting from MongoDB:', error);
    throw error;
  }
}

/**
 * Check if database is connected
 */
export function isDBConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

