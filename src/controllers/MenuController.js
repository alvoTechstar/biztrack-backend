// Hotel menu management — separate from kiosk stock Products.
import { storage } from '../storage.js';

// Only these fields may be written — stray payload fields (e.g. _id, businessType)
// would otherwise be passed to Prisma and rejected as unknown args.
const UPDATABLE_MENU_FIELDS = [
  'name', 'category', 'price', 'description', 'image', 'available', 'businessUUID',
];

const createMenuItem = async (req, res) => {
  try {
    const {
      name,
      category,
      price,
      description = '',
      image = '',
      available = true,
      businessId,
      businessUUID,
    } = req.body;

    const businessIdNumber = Number.parseInt(businessId);

    if (!name || !category || !price || !businessIdNumber) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided: name, category, price, businessId',
      });
    }

    const priceNumber = Number.parseFloat(price);
    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      return res.status(400).json({ success: false, message: 'Price must be greater than 0' });
    }

    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Authentication failed: User ID not found in token' });
    }

    // Prevent duplicate item names within the same business
    const businessItems = await storage.getMenuItems(businessIdNumber);
    const duplicate = businessItems.find(
      (i) => i.name.trim().toLowerCase() === String(name).trim().toLowerCase()
    );
    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: `"${duplicate.name}" is already on your menu.`,
      });
    }

    const item = await storage.createMenuItem({
      name: String(name).trim(),
      category: String(category).trim(),
      price: priceNumber,
      description: String(description || '').trim(),
      image: String(image || ''),
      available: available !== false,
      businessId: businessIdNumber,
      businessUUID: businessUUID || null,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, message: 'Menu item created successfully', item });
  } catch (error) {
    console.error('❌ Create menu item error:', error);

    // P2002 = Prisma unique constraint violation (name + businessId)
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'This item is already on your menu.' });
    }

    res.status(500).json({
      success: false,
      message: 'Server error creating menu item',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

const getMenuItemsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const businessIdNumber = Number.parseInt(businessId);

    if (Number.isNaN(businessIdNumber)) {
      return res.status(400).json({ success: false, message: 'Business ID must be a number' });
    }

    const items = await storage.getMenuItems(businessIdNumber);

    res.status(200).json({
      success: true,
      message: 'Menu items retrieved successfully',
      items,
      count: items.length,
    });
  } catch (error) {
    console.error('❌ Get menu items error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving menu items',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

const updateMenuItem = async (req, res) => {
  try {
    const { id } = req.params;

    const updateData = {};
    for (const field of UPDATABLE_MENU_FIELDS) {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    }

    const existing = await storage.getMenuItem(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    if (updateData.price !== undefined) {
      const priceNumber = Number.parseFloat(updateData.price);
      if (Number.isNaN(priceNumber) || priceNumber <= 0) {
        return res.status(400).json({ success: false, message: 'Price must be greater than 0' });
      }
      updateData.price = priceNumber;
    }

    // Prevent renaming into a duplicate within the same business
    if (updateData.name && updateData.name.trim().toLowerCase() !== existing.name.trim().toLowerCase()) {
      const businessItems = await storage.getMenuItems(existing.businessId);
      const duplicate = businessItems.find(
        (i) => i.id !== id && i.name.trim().toLowerCase() === updateData.name.trim().toLowerCase()
      );
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: `"${duplicate.name}" is already on your menu.`,
        });
      }
    }

    const item = await storage.updateMenuItem(id, updateData);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    res.status(200).json({ success: true, message: 'Menu item updated successfully', item });
  } catch (error) {
    console.error('❌ Update menu item error:', error);

    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'This item is already on your menu.' });
    }

    res.status(500).json({
      success: false,
      message: 'Server error updating menu item',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

const deleteMenuItem = async (req, res) => {
  try {
    const { id } = req.params;

    const item = await storage.deleteMenuItem(id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    res.status(200).json({ success: true, message: 'Menu item deleted successfully', item });
  } catch (error) {
    console.error('❌ Delete menu item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting menu item',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

export {
  createMenuItem,
  getMenuItemsByBusiness,
  updateMenuItem,
  deleteMenuItem,
};
