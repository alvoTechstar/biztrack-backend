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
  
  // Location reference
  kioskId: {
    type: String, // Can be UUID string
    ref: 'Kiosk'
  },
  businessId: {
    type: Number, // Business ID is a number
    ref: 'Business'
  },
  businessUUID: {
    type: String,
    trim: true
  },
  
  // createdBy should be String for UUID
  createdBy: {
    type: String, // CHANGED FROM ObjectId TO String
    required: true,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound index for SKU uniqueness per location
productSchema.index({ sku: 1, kioskId: 1 }, { 
  unique: true, 
  sparse: true, 
  partialFilterExpression: { kioskId: { $exists: true, $type: 'string' } } 
});

productSchema.index({ sku: 1, businessId: 1 }, { 
  unique: true, 
  sparse: true, 
  partialFilterExpression: { businessId: { $exists: true, $type: 'number' } } 
});

// Validate that either kioskId or businessId is provided
productSchema.pre('validate', function(next) {
  if (!this.kioskId && !this.businessId) {
    this.invalidate('location', 'Either kioskId or businessId must be provided');
  }
  if (this.kioskId && this.businessId) {
    this.invalidate('location', 'Only one of kioskId or businessId can be provided');
  }
  next();
});

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