// src/models/Product.js
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  sku: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  stock: {
    type: Number,
    default: 0,
    min: 0
  },
  unit: {
    type: String,
    required: true,
    trim: true
  },
  buyingPrice: {
    type: Number,
    required: true,
    min: 0
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  threshold: {
    type: Number,
    default: 10,
    min: 0
  },
  status: {
    type: String,
    enum: ['In Stock', 'Low Stock', 'Out of Stock'],
    default: 'Out of Stock'
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  
  // ✅ SIMPLIFIED: Use ONLY businessId for ALL locations
  businessId: {
    type: Number, // Always use number
    required: true,
    ref: 'Business'
  },
  businessUUID: {
    type: String,
    trim: true
  },
  
  // ✅ REMOVED: kioskId field - Everything uses businessId
  
  // createdBy should be String for UUID
  createdBy: {
    type: String,
    required: true,
    ref: 'User'
  }
}, {
  timestamps: true
});

// ✅ SIMPLIFIED: Only one index needed
productSchema.index({ sku: 1, businessId: 1 }, { 
  unique: true 
});

// ✅ REMOVED: kioskId validation
// Auto-calculate status before save
productSchema.pre('save', function(next) {
  if (this.stock === 0) {
    this.status = 'Out of Stock';
  } else if (this.stock < this.threshold) {
    this.status = 'Low Stock';
  } else {
    this.status = 'In Stock';
  }
  next();
});

const Product = mongoose.model('Product', productSchema);
export default Product;