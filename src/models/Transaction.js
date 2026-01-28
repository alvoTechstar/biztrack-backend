// models/Transaction.js
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    
    // CHANGE: Use businessId (numeric/String) instead of kioskId (ObjectId)
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
            type: String, // Changed from ObjectId to String
            required: true
        },
        productName: {
            type: String,
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: [0.01, 'Quantity must be at least 0.01'], // CHANGED: Was min: 1, now allows fractional quantities
            validate: {
                validator: function(value) {
                    return value > 0;
                },
                message: 'Quantity must be greater than 0'
            }
        },
        unit: {  // NEW FIELD: Track measurement unit (kg, pieces, liters, etc.)
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

    // Payment information
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    type: {
        type: String,
        enum: ['cash', 'mpesa', 'debt'],
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'mpesa', 'debt'],
        required: true
    },
    originalPaymentMethod: {
        type: String,
        enum: ['cash', 'mpesa', 'debt']
    },
    status: {
        type: String,
        enum: ['completed', 'pending', 'failed'],
        default: 'pending'
    },
    paymentStatus: {
        type: String,
        enum: ['paid', 'pending', 'failed'],
        default: 'pending'
    },

    // Cash payment specific
    amountPaid: {
        type: Number,
        min: 0
    },
    change: {
        type: Number,
        min: 0
    },

    // M-PESA payment specific
    customerPhone: {
        type: String
    },
    mpesaReceipt: {
        type: String
    },

    // Debt payment specific
    customerName: {
        type: String
    },
    notes: {
        type: String
    },
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

    // Payment date fields - NEW
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

    // Payment details - NEW
    paymentDetails: {
        type: mongoose.Schema.Types.Mixed
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

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;