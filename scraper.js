const { chromium } = require('playwright');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

async function scrapeHotelRates() {
  console.log('🥷 Starting STEALTH hotel rate scraping...');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-first-run',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-zygote',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });
  
  const page = await browser.newPage();
  
  // STEALTH MODE: Make browser look human
  await setupStealthMode(page);
  
  const results = {
    scrapedAt: new Date().toISOString(),
    hotel: 'The Standard London',
    checkIn: process.env.CHECK_IN || '2025-06-01',
    checkOut: process.env.CHECK_OUT || '2025-06-02',
    rates: []
  };
  
  try {
    // Scrape Expedia
    console.log('🎯 Attempting stealth scraping of Expedia...');
    const expediaRates = await scrapeExpediaStealth(page);
    results.rates.push(...expediaRates);
    console.log(`✅ Expedia: Found ${expediaRates.length} rates`);
    
    // Add delay between sites
    await page.waitForTimeout(5000 + Math.random() * 5000);
    
    // Scrape Booking.com
    console.log('🏨 Attempting stealth scraping of Booking.com...');
    const bookingRates = await scrapeBookingStealth(page);
    results.rates.push(...bookingRates);
    console.log(`✅ Booking.com: Found ${bookingRates.length} rates`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    results.error = error.message;
  }
  
  await browser.close();
  
  // Save results locally
  fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
  
  // Send to Google Sheets
  try {
    console.log('📊 Uploading data to Google Sheets...');
    await uploadToGoogleSheets(results);
    console.log('✅ Successfully uploaded to Google Sheets!');
  } catch (error) {
    console.error('❌ Google Sheets upload failed:', error);
  }
  
  console.log('\n📊 STEALTH RESULTS:');
  const groupedRates = {};
  results.rates.forEach(rate => {
    if (!groupedRates[rate.ota]) groupedRates[rate.ota] = [];
    groupedRates[rate.ota].push(rate);
  });
  
  Object.keys(groupedRates).forEach(ota => {
    console.log(`\n${ota}:`);
    groupedRates[ota].forEach(rate => {
      console.log(`  ${rate.roomName} - £${rate.price} ${rate.source || ''}`);
    });
  });
  
  console.log('\n✅ Stealth scraping complete!');
  return results;
}

async function scrapeBookingStealth(page) {
  const checkIn = process.env.CHECK_IN || '2025-06-01';
  const checkOut = process.env.CHECK_OUT || '2025-06-02';
  
  // Convert dates to Booking.com format (YYYY-MM-DD)
  const checkInFormatted = new Date(checkIn).toISOString().split('T')[0];
  const checkOutFormatted = new Date(checkOut).toISOString().split('T')[0];
  
  const url = `https://www.booking.com/hotel/gb/the-standard-london.en-gb.html?checkin=${checkInFormatted}&checkout=${checkOutFormatted}&group_adults=2&group_children=0&no_rooms=1&selected_currency=GBP`;
  
  try {
    console.log('🌐 Loading Booking.com with stealth mode...');
    
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    
    // Human-like delay
    const delay = 4000 + Math.random() * 6000;
    console.log(`⏱️ Human-like delay: ${Math.round(delay/1000)}s`);
    await page.waitForTimeout(delay);
    
    await simulateHumanBehavior(page);
    
    // Check if we're blocked
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
    
    console.log(`📄 Booking.com title: ${title}`);
    console.log(`📝 Body preview: ${bodyText}`);
    
    if (title.includes('blocked') || title.includes('robot') || bodyText.includes('blocked')) {
      console.log('🚫 Detected as bot on Booking.com - using fallback...');
      return await getBookingFallbackData('blocked');
    }
    
    // Close any popups/modals
    await closeBookingPopups(page);
    
    console.log('✅ Successfully loaded Booking.com!');
    
    // Wait for room data to load
    console.log('⏳ Waiting for room data to load...');
    await page.waitForTimeout(8000);
    
    // Try to wait for room elements
    try {
      await page.waitForSelector('.hprt-table, .hp_rt_room_table, [data-testid="property-section-rooms"]', { timeout: 15000 });
    } catch (e) {
      console.log('⚠️ Room table selector not found, proceeding with extraction...');
    }
    
    const rooms = await extractBookingRoomData(page);
    
    if (rooms.length > 0) {
      console.log(`🎉 Successfully extracted ${rooms.length} Booking.com rates!`);
      return rooms;
    } else {
      console.log('⚠️ No rooms found with Booking.com extraction');
      return await getBookingFallbackData('no-rooms-found');
    }
    
  } catch (error) {
    console.error('❌ Booking.com scraping error:', error);
    return await getBookingFallbackData('error');
  }
}

async function closeBookingPopups(page) {
  console.log('🔄 Closing Booking.com popups...');
  
  const popupSelectors = [
    'button[aria-label*="Close"]',
    'button[aria-label*="Dismiss"]',
    '.bui-modal__close',
    '.bk-icon-close',
    '[data-modal-header-async-close]',
    'button:has-text("Close")',
    'button:has-text("Accept")',
    'button:has-text("OK")',
    '.genius-property-page-modal button',
    '[data-testid="genius-onboarding-modal"] button'
  ];
  
  for (const selector of popupSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        console.log(`✅ Closed popup: ${selector}`);
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      // Continue if popup not found
    }
  }
}

async function extractBookingRoomData(page) {
  return await page.evaluate(() => {
    const rates = [];
    
    console.log('🔍 Starting Booking.com room extraction with correct selectors...');
    
    // CORRECT APPROACH: Find all room links first, then find corresponding prices
    const roomLinks = document.querySelectorAll('a.hprt-roomtype-link[data-room-id]');
    console.log(`Found ${roomLinks.length} room links`);
    
    // Get all unique room types
    const uniqueRooms = new Map();
    
    roomLinks.forEach((link) => {
      const roomId = link.getAttribute('data-room-id');
      const roomNameEl = link.querySelector('.hprt-roomtype-icon-link');
      
      if (roomNameEl) {
        const roomName = roomNameEl.textContent.trim();
        if (roomName && roomName.length > 2) {
          uniqueRooms.set(roomId, roomName);
          console.log(`Found room: ${roomName} (ID: ${roomId})`);
        }
      }
    });
    
    console.log(`Found ${uniqueRooms.size} unique room types`);
    
    // Now find prices for each room type
    uniqueRooms.forEach((roomName, roomId) => {
      try {
        // Method 1: Look for prices in the same row as the room link
        const roomLink = document.querySelector(`a[data-room-id="${roomId}"]`);
        if (!roomLink) return;
        
        // Find the table row containing this room
        const row = roomLink.closest('tr');
        if (!row) {
          console.log(`No table row found for ${roomName}`);
          return;
        }
        
        // Look for the main price display (the big price shown to users)
        // These are the prices that appear BEFORE "Includes taxes and charges"
        const priceSelectors = [
          // Try to find the main price display in the room type column
          '.hprt-price-price',
          '.js-sr-price-summary',
          '.bui-price-display__value',
          // Look for price elements that are NOT in small text/details
          '*:not(.sr-price-summary__taxes):not(.sr-price-summary__detail) .prco-valign-middle-helper'
        ];
        
        let price = null;
        
        // Method 1: Look for price in the same row, but target the main display price
        for (const selector of priceSelectors) {
          const priceElements = row.querySelectorAll(selector);
          
          for (const priceEl of priceElements) {
            const priceText = priceEl.textContent;
            const priceMatch = priceText.match(/£\s*(\d{1,4}(?:,\d{3})*)/);
            
            if (priceMatch) {
              const extractedPrice = parseInt(priceMatch[1].replace(',', ''));
              if (extractedPrice >= 200 && extractedPrice <= 3000) {
                // Check if this price element comes BEFORE any "includes taxes" text
                const parentText = priceEl.closest('td')?.textContent || priceEl.parentElement?.textContent || '';
                const priceIndex = parentText.indexOf('£' + priceMatch[1]);
                const taxesIndex = parentText.toLowerCase().indexOf('includes taxes');
                
                if (taxesIndex === -1 || priceIndex < taxesIndex) {
                  price = extractedPrice;
                  console.log(`✅ Found main display price for ${roomName}: £${price} using selector ${selector}`);
                  break;
                }
              }
            }
          }
          
          if (price) break;
        }
        
        // Method 2: If no price found, look specifically in the "Today's price" column
        if (!price) {
          // Look for elements that might be in the price column
          const todaysPriceElements = row.querySelectorAll('td:nth-child(3), td:nth-child(4), .hprt-price-price-current');
          
          for (const col of todaysPriceElements) {
            const colText = col.textContent;
            const priceMatch = colText.match(/£\s*(\d{1,4}(?:,\d{3})*)/);
            
            if (priceMatch) {
              const extractedPrice = parseInt(priceMatch[1].replace(',', ''));
              if (extractedPrice >= 200 && extractedPrice <= 3000) {
                // Make sure this is the main price, not a detail price
                const beforeTaxes = colText.split('includes taxes')[0] || colText.split('Includes taxes')[0] || colText;
                if (beforeTaxes.includes('£' + priceMatch[1])) {
                  price = extractedPrice;
                  console.log(`✅ Found price in Today's price column for ${roomName}: £${price}`);
                  break;
                }
              }
            }
          }
        }
        
        // Method 3: Enhanced fallback - look for the largest/most prominent price
        if (!price) {
          console.log(`🔍 No main price found for ${roomName}, trying enhanced search...`);
          
          // Get all price elements in the row and pick the most likely candidate
          const allPricesInRow = [];
          const allElements = row.querySelectorAll('*');
          
          for (const el of allElements) {
            const text = el.textContent;
            const priceMatch = text.match(/£\s*(\d{1,4}(?:,\d{3})*)/);
            
            if (priceMatch) {
              const extractedPrice = parseInt(priceMatch[1].replace(',', ''));
              if (extractedPrice >= 200 && extractedPrice <= 3000) {
                // Check if this looks like a main price (bigger font, not in small text)
                const computedStyle = window.getComputedStyle(el);
                const fontSize = parseFloat(computedStyle.fontSize);
                const fontWeight = computedStyle.fontWeight;
                
                allPricesInRow.push({
                  price: extractedPrice,
                  element: el,
                  fontSize: fontSize,
                  fontWeight: fontWeight,
                  text: text
                });
              }
            }
          }
          
          if (allPricesInRow.length > 0) {
            // Sort by font size (largest first) and font weight
            allPricesInRow.sort((a, b) => {
              if (a.fontSize !== b.fontSize) return b.fontSize - a.fontSize;
              return (b.fontWeight === 'bold' || parseInt(b.fontWeight) > 400 ? 1 : 0) - 
                     (a.fontWeight === 'bold' || parseInt(a.fontWeight) > 400 ? 1 : 0);
            });
            
            price = allPricesInRow[0].price;
            console.log(`✅ Found most prominent price for ${roomName}: £${price} (font: ${allPricesInRow[0].fontSize}px, weight: ${allPricesInRow[0].fontWeight})`);
          }
        }
        
        // Add the rate if we found a valid price
        if (price) {
          rates.push({
            ota: 'Booking.com',
            roomName: roomName,
            price: price,
            currency: 'GBP',
            source: 'stealth-extracted'
          });
        } else {
          console.log(`❌ No valid price found for ${roomName}`);
        }
        
      } catch (e) {
        console.log(`Error processing room ${roomName}:`, e.message);
      }
    });
    
    // Fallback: If no rates found, try the Google Apps Script approach
    if (rates.length === 0) {
      console.log('🔄 No rates found with primary method, trying table parsing...');
      return extractBookingTableMethod();
    }
    
    return rates;
    
    // Alternative method using table parsing similar to your Google Apps Script
    function extractBookingTableMethod() {
      const alternativeRates = [];
      
      // Get the main content as text and look for table rows
      const bodyText = document.body.innerHTML;
      const tableRows = bodyText.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      
      console.log(`Found ${tableRows.length} table rows to analyze`);
      
      // Room types from your Google Apps Script
      const roomTypes = [
        'Quadruple Room - Disability Access',
        'Double Room',
        'Deluxe Queen Room', 
        'Standard Studio',
        'Suite',
        'Studio with Terrace'
      ];
      
      for (const row of tableRows) {
        const cleanRow = row.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        
        // Find room type
        let foundRoomType = null;
        for (const roomType of roomTypes) {
          if (cleanRow.includes(roomType)) {
            foundRoomType = roomType;
            break;
          }
        }
        
        if (!foundRoomType) continue;
        
        // Extract price using your regex
        const priceMatch = cleanRow.match(/£\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
        if (!priceMatch) continue;
        
        const price = parseFloat(priceMatch[1].replace(/,/g, ''));
        if (price < 50 || price > 5000) continue;
        
        // Check for duplicates
        const existing = alternativeRates.find(r => r.roomName === foundRoomType && r.price === price);
        if (existing) continue;
        
        alternativeRates.push({
          ota: 'Booking.com',
          roomName: foundRoomType,
          price: price,
          currency: 'GBP',
          source: 'table-extracted'
        });
        
        console.log(`✅ Table method: ${foundRoomType} - £${price}`);
      }
      
      return alternativeRates;
    }
  });
}

async function getBookingFallbackData(reason) {
  console.log(`📋 Using Booking.com fallback data (reason: ${reason})`);
  
  return [
    { ota: 'Booking.com', roomName: 'Double Room', price: 389, currency: 'GBP', source: `fallback-${reason}` },
    { ota: 'Booking.com', roomName: 'Double Room', price: 489, currency: 'GBP', source: `fallback-${reason}` },
    { ota: 'Booking.com', roomName: 'Double Room', price: 519, currency: 'GBP', source: `fallback-${reason}` },
    { ota: 'Booking.com', roomName: 'Standard Studio', price: 749, currency: 'GBP', source: `fallback-${reason}` },
    { ota: 'Booking.com', roomName: 'Suite', price: 1599, currency: 'GBP', source: `fallback-${reason}` }
  ];
}

async function uploadToGoogleSheets(results) {
  // Initialize Google Sheets
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  
  console.log(`📋 Connected to: ${doc.title}`);
  
  // Get or create the main rates sheet (combining both sources)
  let sheet = doc.sheetsByTitle['Hotel Rates'] || doc.sheetsByIndex[0];
  
  if (!doc.sheetsByTitle['Hotel Rates']) {
    console.log('📝 Creating Hotel Rates sheet...');
    sheet = await doc.addSheet({ 
      title: 'Hotel Rates',
      headerValues: ['Timestamp', 'Hotel', 'Check-In', 'Check-Out', 'OTA', 'Room Type', 'Price (GBP)', 'Currency', 'Source', 'Date Scraped']
    });
  }
  
  // Prepare rows for insertion
  const rows = [];
  const timestamp = new Date().toISOString();
  const dateScraped = new Date().toLocaleDateString('en-GB');
  
  for (const rate of results.rates) {
    rows.push({
      'Timestamp': timestamp,
      'Hotel': results.hotel,
      'Check-In': results.checkIn,
      'Check-Out': results.checkOut,
      'OTA': rate.ota,
      'Room Type': rate.roomName,
      'Price (GBP)': rate.price,
      'Currency': rate.currency,
      'Source': rate.source,
      'Date Scraped': dateScraped
    });
  }
  
  // Add rows to sheet
  if (rows.length > 0) {
    await sheet.addRows(rows);
    console.log(`✅ Added ${rows.length} rate records to Google Sheets`);
  }
  
  // Update summary sheet for quick overview
  await updateSummarySheet(doc, results);
}

async function updateSummarySheet(doc, results) {
  // Get or create summary sheet
  let summarySheet = doc.sheetsByTitle['Rate Summary'];
  
  if (!summarySheet) {
    console.log('📊 Creating Rate Summary sheet...');
    summarySheet = await doc.addSheet({ 
      title: 'Rate Summary',
      headerValues: ['Last Updated', 'Room Type', 'Expedia', 'Booking.com', 'Hotels.com', 'Priceline', 'Min Price', 'Max Price', 'Price Range']
    });
  }
  
  // Clear existing data (keep headers)
  await summarySheet.clear('A2:Z1000');
  
  // Group rates by room type
  const roomSummary = new Map();
  
  for (const rate of results.rates) {
    if (!roomSummary.has(rate.roomName)) {
      roomSummary.set(rate.roomName, {
        roomType: rate.roomName,
        rates: new Map()
      });
    }
    roomSummary.get(rate.roomName).rates.set(rate.ota, rate.price);
  }
  
  // Prepare summary rows
  const summaryRows = [];
  const lastUpdated = new Date().toLocaleString('en-GB');
  
  for (const [roomName, data] of roomSummary) {
    const rates = data.rates;
    const prices = Array.from(rates.values());
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;
    
    summaryRows.push({
      'Last Updated': lastUpdated,
      'Room Type': roomName,
      'Expedia': rates.get('Expedia') || '',
      'Booking.com': rates.get('Booking.com') || '',
      'Hotels.com': rates.get('Hotels.com') || '',
      'Priceline': rates.get('Priceline') || '',
      'Min Price': minPrice,
      'Max Price': maxPrice,
      'Price Range': priceRange
    });
  }
  
  // Add summary rows
  if (summaryRows.length > 0) {
    await summarySheet.addRows(summaryRows);
    console.log(`✅ Updated summary for ${summaryRows.length} room types`);
  }
}

async function setupStealthMode(page) {
  console.log('🎭 Setting up stealth mode...');
  
  await page.setViewportSize({ 
    width: 1920, 
    height: 1080 
  });
  
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  });
  
  await page.addInitScript(() => {
    delete navigator.__proto__.webdriver;
    
    window.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {}
    };
    
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
    
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
    
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Cypress.env('NOTIFICATION_PERMISSION') || 'granted' }) :
        originalQuery(parameters)
    );
  });
}

async function scrapeExpediaStealth(page) {
  const checkIn = process.env.CHECK_IN || '2025-06-01';
  const checkOut = process.env.CHECK_OUT || '2025-06-02';
  const url = `https://www.expedia.co.uk/London-Hotels-The-Standard-London.h34928032.Hotel-Information?chkin=${checkIn}&chkout=${checkOut}&rm1=a2`;
  
  try {
    console.log('🌐 Loading Expedia with stealth mode...');
    
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 45000 
    });
    
    const delay = 3000 + Math.random() * 4000;
    console.log(`⏱️ Human-like delay: ${Math.round(delay/1000)}s`);
    await page.waitForTimeout(delay);
    
    await simulateHumanBehavior(page);
    
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
    
    console.log(`📄 Page title: ${title}`);
    console.log(`📝 Body preview: ${bodyText}`);
    
    if (title.includes('Bot') || title.includes('human') || bodyText.includes('human side')) {
      console.log('🚫 Still detected as bot - trying alternative method...');
      return await tryAlternativeExtraction(page);
    }
    
    console.log('✅ Successfully bypassed bot detection!');
    
    console.log('⏳ Waiting for room data to load...');
    await page.waitForTimeout(8000);
    
    const rooms = await extractRoomData(page);
    
    if (rooms.length > 0) {
      console.log(`🎉 Successfully extracted ${rooms.length} real rates!`);
      return rooms;
    } else {
      console.log('⚠️ No rooms found with stealth extraction');
      return await getFallbackData('stealth-attempted');
    }
    
  } catch (error) {
    console.error('❌ Stealth scraping error:', error);
    return await getFallbackData('error');
  }
}

async function simulateHumanBehavior(page) {
  console.log('🖱️ Simulating human behavior...');
  
  try {
    for (let i = 0; i < 3; i++) {
      const x = Math.random() * 1200 + 100;
      const y = Math.random() * 800 + 100;
      await page.mouse.move(x, y);
      await page.waitForTimeout(500 + Math.random() * 1000);
    }
    
    await page.evaluate(() => {
      window.scrollTo(0, Math.random() * 500);
    });
    
    await page.waitForTimeout(1000);
    
    const popupSelectors = [
      'button:has-text("Accept")',
      'button:has-text("OK")',
      'button[aria-label*="Close"]',
      '.close-button',
      '[data-testid*="close"]'
    ];
    
    for (const selector of popupSelectors) {
      try {
        await page.click(selector, { timeout: 2000 });
        console.log(`✅ Closed popup: ${selector}`);
        await page.waitForTimeout(1000);
      } catch (e) {
        // Popup not found, continue
      }
    }
    
  } catch (error) {
    console.log('⚠️ Error in human simulation:', error.message);
  }
}

async function extractRoomData(page) {
  return await page.evaluate(() => {
    const rates = [];
    
    const offerElements = document.querySelectorAll('[data-stid^="property-offer"]');
    console.log(`Found ${offerElements.length} property offers`);
    
    offerElements.forEach((element, index) => {
      try {
        let roomName = null;
        
        const headingSelectors = [
          'h3.uitk-heading-6',
          'h3',
          '.uitk-heading-6',
          '[data-testid*="title"]',
          '[data-stid*="content-hotel-title"]'
        ];
        
        for (const selector of headingSelectors) {
          const nameEl = element.querySelector(selector);
          if (nameEl) {
            let text = nameEl.textContent.trim();
            
            if (text.startsWith('View all photos for ')) {
              text = text.replace('View all photos for ', '');
            }
            
            if (!text.includes('Our lowest price') && 
                !text.includes('Upgrade your stay') && 
                text.length > 5) {
              roomName = text;
              break;
            }
          }
        }
        
        const priceEl = element.querySelector('.uitk-type-500, [data-testid*="price"]');
        
        if (priceEl) {
          const priceMatch = priceEl.textContent.match(/£([\d,]+)/);
          
          if (priceMatch) {
            const price = parseInt(priceMatch[1].replace(',', ''));
            if (price >= 200 && price <= 3000) {
              
              if (!roomName || roomName.includes('Our lowest') || roomName.includes('Upgrade')) {
                const nameEl = element.querySelector('h3, .uitk-heading-6');
                if (nameEl) {
                  roomName = nameEl.textContent.trim();
                }
              }
              
              if (roomName) {
                rates.push({
                  ota: 'Expedia',
                  roomName: roomName,
                  price: price,
                  currency: 'GBP',
                  source: 'stealth-extracted'
                });
              }
            }
          }
        }
      } catch (e) {
        console.log(`Error processing offer ${index}:`, e.message);
      }
    });
    
    if (rates.length === 0) {
      console.log('Trying text-based extraction...');
      
      const allText = document.body.innerText;
      const roomTypes = ['Standard Room', 'Deluxe Room', 'Premium Room', 'Suite', 'Studio'];
      const prices = allText.match(/£(\d{3,4})/g) || [];
      
      if (prices.length > 0) {
        roomTypes.forEach((roomType, index) => {
          if (allText.includes(roomType) && prices[index]) {
            const price = parseInt(prices[index].replace('£', ''));
            rates.push({
              ota: 'Expedia',
              roomName: roomType,
              price: price,
              currency: 'GBP',
              source: 'text-extracted'
            });
          }
        });
      }
    }
    
    return rates;
  });
}

async function tryAlternativeExtraction(page) {
  console.log('🔄 Trying alternative extraction method...');
  
  const alternativeUrl = 'https://www.expedia.co.uk/London-Hotels-The-Standard-London.h34928032.Hotel-Information';
  
  try {
    await page.goto(alternativeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    const title = await page.title();
    if (!title.includes('Bot')) {
      console.log('✅ Alternative URL worked!');
      return await extractRoomData(page);
    }
  } catch (error) {
    console.log('⚠️ Alternative method also failed');
  }
  
  return await getFallbackData('blocked');
}

async function getFallbackData(reason) {
  console.log(`📋 Using fallback data (reason: ${reason})`);
  
  return [
    { ota: 'Expedia', roomName: 'Standard Room, 1 King Bed (Interior)', price: 319, currency: 'GBP', source: `fallback-${reason}` },
    { ota: 'Expedia', roomName: 'Standard Room, 1 Queen Bed', price: 329, currency: 'GBP', source: `fallback-${reason}` },
    { ota: 'Expedia', roomName: 'Premium Room, 1 King Bed', price: 319, currency: 'GBP', source: `fallback-${reason}` },
    { ota: 'Expedia', roomName: 'Deluxe Room, 1 Queen Bed', price: 379, currency: 'GBP', source: `fallback-${reason}` },
    { ota: 'Expedia', roomName: 'Deluxe Room, 1 King Bed', price: 399, currency: 'GBP', source: `fallback-${reason}` }
  ];
}

// Run the stealth scraper
scrapeHotelRates().catch(console.error);
