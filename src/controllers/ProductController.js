import Product from '../models/Product.js';

// @desc    Create a new product
// @route   POST /api/products
// @access  Private
const createProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      category,
      stock = 0,
      unit,
      buyingPrice,
      price,
      threshold = 0,
      kioskId,
      businessId,
      businessUUID
    } = req.body;

    console.log('📝 Creating product with data:', {
      name,
      sku,
      category,
      stock,
      unit,
      buyingPrice,
      price,
      threshold,
      kioskId,
      businessId,
      businessUUID,
      createdBy: req.user?.id
    });

    // Determine the ID to use
    let locationId = kioskId || businessId;
    let locationType = kioskId ? 'kioskId' : 'businessId';

    // Validate required fields
    if (!name || !sku || !category || !unit || !buyingPrice || !price || !locationId) {
      return res.status(400).json({
        success: false,
        message: `All required fields must be provided: name, sku, category, unit, buyingPrice, price, ${locationType}`
      });
    }

    // Validate buyingPrice > 0
    if (buyingPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Buying price must be greater than 0'
      });
    }

    // Validate price >= buyingPrice
    if (price < buyingPrice) {
      return res.status(400).json({
        success: false,
        message: 'Price must be greater than or equal to buying price'
      });
    }

    // ✅ CHECK IF req.user.id EXISTS
    if (!req.user || !req.user.id) {
      console.error('❌ CRITICAL ERROR: req.user.id is undefined');
      console.error('   - req.user:', req.user);
      console.error('   - req.user?.id:', req.user?.id);
      return res.status(401).json({
        success: false,
        message: 'Authentication failed: User ID not found in token'
      });
    }

    // Create product data
    const productData = {
      name,
      sku,
      category,
      stock,
      unit,
      buyingPrice,
      price,
      threshold,
      createdBy: req.user.id, // This should be a UUID string
      businessUUID
    };

    // Set the appropriate ID field
    if (kioskId) {
      productData.kioskId = kioskId;
    } else {
      productData.businessId = businessId;
    }

    console.log('📦 Product data for creation:', productData);

    // Check for existing SKU in the same location
    const existingProduct = await Product.findOne({
      sku,
      $or: [
        { kioskId: kioskId || null },
        { businessId: businessId || null }
      ].filter(condition => {
        const value = Object.values(condition)[0];
        return value !== null && value !== undefined && value !== '';
      })
    });

    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: 'SKU already exists in this location'
      });
    }

    // Create product
    const product = await Product.create(productData);

    console.log('✅ Product created successfully:', product);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    console.error('❌ Create product error:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'SKU already exists'
      });
    }

    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error creating product'
    });
  }
};

// @desc    Get all products for a kiosk or business
// @route   GET /api/products/:locationType/:locationId
// @access  Private
const getProductsByLocation = async (req, res) => {
  try {
    const { locationType, locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        message: 'Location ID is required'
      });
    }

    // Build query based on location type
    let query = {};
    if (locationType === 'kiosk') {
      query.kioskId = locationId;
    } else if (locationType === 'business') {
      query.businessId = parseInt(locationId) || locationId;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid location type. Use "kiosk" or "business"'
      });
    }

    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      products,
      count: products.length
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving products'
    });
  }
};

// @desc    Get all products by kiosk (for backward compatibility)
// @route   GET /api/products/kiosk/:kioskId
// @access  Private
const getProductsByKiosk = async (req, res) => {
  try {
    const { kioskId } = req.params;

    if (!kioskId) {
      return res.status(400).json({
        success: false,
        message: 'Kiosk ID is required'
      });
    }

    const products = await Product.find({ kioskId })
      .sort({ createdAt: -1 })
      .populate('createdBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      products,
      count: products.length
    });
  } catch (error) {
    console.error('Get products by kiosk error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving products'
    });
  }
};

// @desc    Get all products by business
// @route   GET /api/products/business/:businessId
// @access  Private
const getProductsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business ID is required'
      });
    }

    // Try to parse as number first, otherwise use as string
    const businessIdNum = parseInt(businessId);
    const query = isNaN(businessIdNum) ? { businessId: businessId } : { businessId: businessIdNum };

    console.log('Query for products:', query);

    // TEMPORARY FIX: Remove populate to avoid ObjectId casting error
    const products = await Product.find(query)
      .sort({ createdAt: -1 });
    // .populate('createdBy', 'firstName lastName email'); // Comment this out

    console.log(`Found ${products.length} products`);

    res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      products,
      count: products.length
    });
  } catch (error) {
    console.error('❌ Get products by business error:', error);
    console.error('Error stack:', error.stack);

    // More detailed error information
    res.status(500).json({
      success: false,
      message: 'Server error retrieving products',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    console.log('📝 Updating product:', id, 'with data:', updateData);

    const existingProduct = await Product.findById(id);

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Update status based on stock
    if (updateData.stock !== undefined || updateData.threshold !== undefined) {
      const stock = updateData.stock !== undefined ? updateData.stock : existingProduct.stock;
      const threshold = updateData.threshold !== undefined ? updateData.threshold : existingProduct.threshold;

      if (stock === 0) {
        updateData.status = 'Out of Stock';
      } else if (stock < threshold) {
        updateData.status = 'Low Stock';
      } else {
        updateData.status = 'In Stock';
      }
    }

    // Validate price
    if (updateData.price !== undefined || updateData.buyingPrice !== undefined) {
      const price = updateData.price !== undefined ? updateData.price : existingProduct.price;
      const buyingPrice = updateData.buyingPrice !== undefined ? updateData.buyingPrice : existingProduct.buyingPrice;

      if (price < buyingPrice) {
        return res.status(400).json({
          success: false,
          message: 'Price must be greater than or equal to buying price'
        });
      }
    }

    // Check for duplicate SKU in the same location
    if (updateData.sku && updateData.sku !== existingProduct.sku) {
      const locationQuery = existingProduct.kioskId
        ? { kioskId: existingProduct.kioskId }
        : { businessId: existingProduct.businessId };

      const duplicateProduct = await Product.findOne({
        sku: updateData.sku,
        _id: { $ne: id },
        ...locationQuery
      });

      if (duplicateProduct) {
        return res.status(400).json({
          success: false,
          message: 'SKU already exists in this location'
        });
      }
    }

    const product = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    console.log('✅ Product updated successfully:', product);

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    console.error('❌ Update product error:', error);

    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'SKU already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error updating product'
    });
  }
};

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    console.log('🗑️ Deleting product:', id);

    const product = await Product.findByIdAndDelete(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    console.log('✅ Product deleted successfully:', product);

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
      product
    });
  } catch (error) {
    console.error('❌ Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting product'
    });
  }
};

// @desc    Update product stock
// @route   PUT /api/products/:id/stock
// @access  Private
const updateProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;

    console.log('📊 Updating stock for product:', id, 'new stock:', stock);

    if (stock === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Stock value is required'
      });
    }

    const existingProduct = await Product.findById(id);

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Determine new status based on stock
    let status = 'In Stock';
    if (stock === 0) {
      status = 'Out of Stock';
    } else if (stock < existingProduct.threshold) {
      status = 'Low Stock';
    }

    const product = await Product.findByIdAndUpdate(
      id,
      { stock, status },
      { new: true, runValidators: true }
    );

    console.log('✅ Stock updated successfully:', product);

    res.status(200).json({
      success: true,
      message: 'Stock updated successfully',
      product
    });
  } catch (error) {
    console.error('❌ Update stock error:', error);

    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error updating stock'
    });
  }
};

export {
  createProduct,
  getProductsByLocation,
  getProductsByKiosk,
  getProductsByBusiness,
  updateProduct,
  deleteProduct,
  updateProductStock
};