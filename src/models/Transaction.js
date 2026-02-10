// models/Transaction.js - UPDATED VERSION
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    
    // Business information
    businessId: {
        type: String,
        required: true
    },
    businessUUID: {
        type: String,
        required: true
    },
    businessName: {
        type: String
    },
    businessType: {
        type: String
    },

    // Shopkeeper information
    shopkeeperId: {
        type: String,
        required: true
    },
    shopkeeperName: {
        type: String,
        required: true
    },
    shopkeeperEmail: {
        type: String
    },
    shopkeeperPhone: {
        type: String
    },
    shopkeeperRole: {
        type: String,
        default: 'Kiosk_Shopkeeper'
    },

    // Transaction items
    items: [{
        productId: {
            type: String,
            required: true
        },
        productName: {
            type: String,
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: [0.01, 'Quantity must be at least 0.01'],
            validate: {
                validator: function(value) {
                    return value > 0;
                },
                message: 'Quantity must be greater than 0'
            }
        },
        unit: {
            type: String,
            default: 'units',
            trim: true
        },
        unitPrice: {
            type: Number,
            required: true,
            min: 0
        },
        totalPrice: {
            type: Number,
            required: true
        }
    }],

    // Financial information
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    
    // Transaction type - FIXED: Changed enum values
    type: {
        type: String,
        enum: ['sale', 'debt', 'refund', 'return', 'adjustment'],
        default: 'sale'
    },
    
    // Payment method - Separate from transaction type
    paymentMethod: {
        type: String,
        enum: ['cash', 'mpesa', 'debt'],
        required: true
    },
    
    // For debt payments that were paid later
    originalPaymentMethod: {
        type: String,
        enum: ['cash', 'mpesa', 'debt']
    },
    
    // Transaction status
    status: {
        type: String,
        enum: ['completed', 'pending', 'failed', 'cancelled'],
        default: 'pending'
    },
    
    // Payment status
    paymentStatus: {
        type: String,
        enum: ['paid', 'pending', 'failed', 'cancelled'],
        default: 'pending'
    },

    // Cash payment specific
    amountPaid: {
        type: Number,
        default: 0,
        min: 0
    },
    change: {
        type: Number,
        default: 0,
        min: 0
    },

    // M-PESA payment specific
    customerPhone: {
        type: String
    },
    mpesaReceipt: {
        type: String
    },
    
    // M-PESA transaction IDs
    checkoutRequestId: {
        type: String,
        index: true
    },
    merchantRequestId: {
        type: String,
        index: true
    },

    // Customer information (for debt transactions)
    customerName: {
        type: String,
        default: ''
    },
    notes: {
        type: String
    },
    
    // Debt payment specific
    debtPaid: {
        type: Boolean,
        default: false
    },
    debtPaymentMethod: {
        type: String,
        enum: ['cash', 'mpesa', null]
    },
    debtPaymentDate: {
        type: Date
    },

    // Payment date fields
    datePaid: {
        type: Date
    },
    paidAt: {
        type: Date
    },
    paymentDate: {
        type: Date
    },
    completedAt: {
        type: Date
    },

    // Payment details (for storing M-PESA response, callback data, etc.)
    paymentDetails: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },

    // General transaction info
    timestamp: {
        type: Date,
        default: Date.now
    },
    errorMessage: {
        type: String
    }
}, {
    timestamps: true
});

// Update indexes for business-based queries
transactionSchema.index({ businessId: 1, timestamp: -1 });
transactionSchema.index({ shopkeeperId: 1, timestamp: -1 });
transactionSchema.index({ businessId: 1, status: 1 });
transactionSchema.index({ businessId: 1, paymentMethod: 1 });
transactionSchema.index({ businessId: 1, debtPaid: 1 });
transactionSchema.index({ transactionId: 1 }); // Add this for faster lookups
transactionSchema.index({ checkoutRequestId: 1 }); // Add this for M-PESA callbacks

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;