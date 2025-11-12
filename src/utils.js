import { Buffer } from "buffer";

export function formatPhoneNumber(phone) {
  if (!phone) {
    throw new Error('Phone number is required');
  }

  // Remove any non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  if (!cleaned) {
    throw new Error('Phone number must contain digits');
  }

  // Handle Kenyan numbers
  if (cleaned.startsWith('0')) {
    // Remove leading 0 and add 254
    return '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('254')) {
    // Already in correct format
    return cleaned;
  } else if (cleaned.startsWith('7') && cleaned.length === 9) {
    // Mobile number without country code
    return '254' + cleaned;
  }

  // If it doesn't match expected patterns, try to format as 254...
  if (cleaned.length === 9 && /^[7][0-9]{8}$/.test(cleaned)) {
    return '254' + cleaned;
  }

  // Last attempt - if it's 12 digits and starts with 254
  if (cleaned.length === 12 && cleaned.startsWith('254')) {
    return cleaned;
  }

  // If we can't format it properly, throw an error instead of returning
  throw new Error(`Unable to format phone number: ${phone}. Expected Kenyan format.`);
}

// Validate phone number format
export function isValidPhoneNumber(phone) {
  if (!phone) return false;

  const cleaned = phone.replace(/\D/g, '');

  // Check various valid Kenyan formats
  const patterns = [
    /^0[7][0-9]{8}$/, // 0712345678
    /^254[7][0-9]{8}$/, // 254712345678
    /^[7][0-9]{8}$/, // 712345678
  ];

  return patterns.some(pattern => pattern.test(cleaned));
}

// Generate M-Pesa password
export function generateMpesaPassword(shortCode, passKey) {
  const timestamp = getTimestamp();
  const concatenated = shortCode + passKey + timestamp;
  return Buffer.from(concatenated).toString('base64');
}

// Get current timestamp in M-Pesa format (EAT timezone)
export function getTimestamp() {
  const now = new Date();
  // Convert to EAT (UTC+3) for M-Pesa
  const eatTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));

  const year = eatTime.getUTCFullYear();
  const month = (eatTime.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = eatTime.getUTCDate().toString().padStart(2, '0');
  const hours = eatTime.getUTCHours().toString().padStart(2, '0');
  const minutes = eatTime.getUTCMinutes().toString().padStart(2, '0');
  const seconds = eatTime.getUTCSeconds().toString().padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// Helper to display user-friendly phone numbers
export function displayPhoneNumber(phone) {
  try {
    const formatted = formatPhoneNumber(phone);
    return `+${formatted}`;
  } catch (e) {
    return phone; // Return original if formatting fails
  }
}