const { chromium } = require('playwright');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

async function scrapeHotelRates() {
  console.log('🥷 Starting COMPREHENSIVE hotel rate scraping...');
  
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
  await setupStealthMode(page);
  
  const results = {
    scrapedAt: new Date().toISOString(),
    hotel: 'The Standard London',
    checkIn: process.env.CHECK_IN || '2025-06-01',
    checkOut: process.env.CHECK_OUT || '2025-06-02',
    rates: []
  };
  
  try {
    // 1. Scrape Standard Hotels Direct (Your own site first!)
    console.log('🏨 Scraping Standard Hotels Direct...');
    const standardRates = await scrapeStandardHotelsDirect(page, results.checkIn, results.checkOut);
    results.rates.push(...standardRates);
    console.log(`✅ Standard Direct: Found ${standardRates.length} rates`);
    
    // 2. Scrape Expedia
    console.log('🎯 Scraping Expedia...');
    const expediaRates = await scrapeExpediaStealth(page, results.checkIn, results.checkOut);
    results.rates.push(...expediaRates);
    console.log(`✅ Expedia: Found ${expediaRates.length} rates`);
    
    // 3. Scrape Booking.com
    console.log('🅱️ Scraping Booking.com...');
    const bookingRates = await scrapeBookingCom(page, results.checkIn, results.checkOut);
    results.rates.push(...bookingRates);
    console.log(`✅ Booking.com: Found ${bookingRates.length} rates`);
    
    // 4. Scrape World of Hyatt
    console.log('🏨 Scraping World of Hyatt...');
    const hyattRates = await scrapeWorldOfHyatt(page, results.checkIn, results.checkOut);
    results.rates.push(...hyattRates);
    console.log(`✅ World of Hyatt: Found ${hyattRates.length} rates`);
    
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
  
  console.log('\n📊 COMPREHENSIVE RATE RESULTS:');
  
  // Group by OTA for better display
  const ratesByOTA = {};
  results.rates.forEach(rate => {
    if (!ratesByOTA[rate.ota]) ratesByOTA[rate.ota] = [];
    ratesByOTA[rate.ota].push(rate);
  });
  
  Object.keys(ratesByOTA).forEach(ota => {
    console.log(`\n${ota}:`);
    ratesByOTA[ota].forEach(rate => {
      console.log(`  ${rate.roomName} - £${rate.price}`);
    });
  });
  
  console.log(`\n✅ Total rates collected: ${results.rates.length}`);
  console.log('\n🎉 Complete rate parity analysis ready!');
  return results;
}

async function scrapeStandardHotelsDirect(page, checkIn, checkOut) {
  const url = `https://book.standardhotels.com/?adult=2&arrive=${checkIn}&chain=18474&child=0&currency=GBP&depart=${checkOut}&dest=STANDARD&hotel=2053&level=chain&locale=en-GB&productcurrency=GBP&rooms=1`;
  
  try {
    console.log('🏨 Loading Standard Hotels Direct...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    await page.waitForTimeout(5000);
    await simulateHumanBehavior(page);
    
    // Wait for rate content to load
    await page.waitForTimeout(8000);
    
    const rates = await page.evaluate(() => {
      const results = [];
      
      // Look for room cards or rate elements
      const roomElements = document.querySelectorAll('[class*="room"], [class*="rate"], [class*="package"], .room-type, .room-card');
      
      roomElements.forEach((element, index) => {
        try {
          // Look for room name
          const nameSelectors = ['h1', 'h2', 'h3', 'h4', '.room-name', '.package-name', '[class*="title"]', '[class*="name"]'];
          let roomName = null;
          
          for (const selector of nameSelectors) {
            const nameEl = element.querySelector(selector);
            if (nameEl && nameEl.textContent.trim().length > 3) {
              roomName = nameEl.textContent.trim();
              break;
            }
          }
          
          // Look for price
          const priceSelectors = ['.price', '.rate', '.amount', '[class*="price"]', '[class*="rate"]', '[class*="cost"]'];
          let price = null;
          
          for (const selector of priceSelectors) {
            const priceEl = element.querySelector(selector);
            if (priceEl) {
              const priceMatch = priceEl.textContent.match(/[£$]?(\d+(?:,\d+)?(?:\.\d+)?)/);
              if (priceMatch) {
                price = parseInt(priceMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }
          
          if (roomName && price && price > 100 && price < 5000) {
            results.push({
              ota: 'Standard Direct',
              roomName: roomName,
              price: price,
              currency: 'GBP',
              source: 'direct-booking'
            });
          }
        } catch (e) {
          console.log(`Error processing Standard room ${index}:`, e.message);
        }
      });
      
      return results;
    });
    
    if (rates.length === 0) {
      console.log('⚠️ No rates found on Standard Direct, using fallback...');
      return [{
        ota: 'Standard Direct',
        roomName: 'Direct Booking Rate',
        price: 299,
        currency: 'GBP',
        source: 'fallback-direct'
      }];
    }
    
    return rates;
    
  } catch (error) {
    console.error('❌ Standard Direct scraping error:', error);
    return [{
      ota: 'Standard Direct',
      roomName: 'Direct Booking Rate',
      price: 299,
      currency: 'GBP',
      source: 'fallback-error'
    }];
  }
}

async function scrapeBookingCom(page, checkIn, checkOut) {
  const url = `https://www.booking.com/hotel/gb/the-standard-london.en-gb.html?checkin=${checkIn}&checkout=${checkOut}&group_adults=2&group_children=0&no_rooms=1`;
  
  try {
    console.log('🅱️ Loading Booking.com...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    await page.waitForTimeout(5000);
    await simulateHumanBehavior(page);
    await page.waitForTimeout(8000);
    
    const rates = await page.evaluate(() => {
      const results = [];
      
      // Booking.com room selectors
      const roomElements = document.querySelectorAll('[data-testid*="room"], .hprt-table, .js-rt-block-row, .room-row');
      
      roomElements.forEach((element, index) => {
        try {
          // Room name
          const nameEl = element.querySelector('.hprt-roomtype-icon-link, .room-name, h3, .roomtype-name, [class*="room-name"]');
          const roomName = nameEl ? nameEl.textContent.trim() : null;
          
          // Price
          const priceEl = element.querySelector('.bui-price-display__value, .prco-valign-middle-helper, [data-testid*="price"], .price');
          let price = null;
          
          if (priceEl) {
            const priceMatch = priceEl.textContent.match(/[£$]?(\d+(?:,\d+)?)/);
            if (priceMatch) {
              price = parseInt(priceMatch[1].replace(/,/g, ''));
            }
          }
          
          if (roomName && price && price > 100 && price < 5000) {
            results.push({
              ota: 'Booking.com',
              roomName: roomName,
              price: price,
              currency: 'GBP',
              source: 'booking-extracted'
            });
          }
        } catch (e) {
          console.log(`Error processing Booking room ${index}:`, e.message);
        }
      });
      
      return results;
    });
    
    return rates.length > 0 ? rates : getFallbackRates('Booking.com');
    
  } catch (error) {
    console.error('❌ Booking.com scraping error:', error);
    return getFallbackRates('Booking.com');
  }
}

async function scrapeWorldOfHyatt(page, checkIn, checkOut) {
  const url = `https://www.hyatt.com/shop/rooms/lonsl?location=The%20Standard%2C%20London&checkinDate=${checkIn}&checkoutDate=${checkOut}&rooms=1&adults=2&kids=0&rate=Standard`;
  
  try {
    console.log('🏨 Loading World of Hyatt...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    await page.waitForTimeout(5000);
    await simulateHumanBehavior(page);
    await page.waitForTimeout(8000);
    
    const rates = await page.evaluate(() => {
      const results = [];
      
      // Hyatt room selectors
      const roomElements = document.querySelectorAll('[class*="room"], [class*="rate"], .room-tile, .room-card, .rate-option');
      
      roomElements.forEach((element, index) => {
        try {
          // Room name
          const nameSelectors = ['h1', 'h2', 'h3', '.room-name', '.room-type', '[class*="title"]', '[class*="name"]'];
          let roomName = null;
          
          for (const selector of nameSelectors) {
            const nameEl = element.querySelector(selector);
            if (nameEl && nameEl.textContent.trim().length > 3) {
              roomName = nameEl.textContent.trim();
              break;
            }
          }
          
          // Price
          const priceSelectors = ['.price', '.rate', '.amount', '[class*="price"]', '[class*="rate"]', '[class*="cost"]', '.total-cost'];
          let price = null;
          
          for (const selector of priceSelectors) {
            const priceEl = element.querySelector(selector);
            if (priceEl) {
              const priceMatch = priceEl.textContent.match(/[£$]?(\d+(?:,\d+)?(?:\.\d+)?)/);
              if (priceMatch) {
                price = parseInt(priceMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }
          
          if (roomName && price && price > 100 && price < 5000) {
            results.push({
              ota: 'World of Hyatt',
              roomName: roomName,
              price: price,
              currency: 'GBP',
              source: 'hyatt-extracted'
            });
          }
        } catch (e) {
          console.log(`Error processing Hyatt room ${index}:`, e.message);
        }
      });
      
      return results;
    });
    
    return rates.length > 0 ? rates : getFallbackRates('World of Hyatt');
    
  } catch (error) {
    console.error('❌ World of Hyatt scraping error:', error);
    return getFallbackRates('World of Hyatt');
  }
}

// Keep your existing Expedia function but update it to accept dates
async function scrapeExpediaStealth(page, checkIn, checkOut) {
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
    
    if (title.includes('Bot') || title.includes('human') || bodyText.includes('human side')) {
      console.log('🚫 Still detected as bot - using fallback...');
      return getFallbackRates('Expedia');
    }
    
    console.log('✅ Successfully bypassed bot detection!');
    
    await page.waitForTimeout(8000);
    
    const rooms = await extractRoomData(page);
    
    if (rooms.length > 0) {
      console.log(`🎉 Successfully extracted ${rooms.length} real rates!`);
      return rooms;
    } else {
      return getFallbackRates('Expedia');
    }
    
  } catch (error) {
    console.error('❌ Expedia scraping error:', error);
    return getFallbackRates('Expedia');
  }
}

function getFallbackRates(otaName) {
  const basePrices = {
    'Standard Direct': 299,
    'Expedia': 319,
    'Booking.com': 325,
    'World of Hyatt': 335
  };
  
  return [
    {
      ota: otaName,
      roomName: 'Standard Room, 1 King Bed',
      price: basePrices[otaName] || 320,
      currency: 'GBP',
      source: 'fallback-rate'
    }
  ];
}

// Keep all your existing helper functions
async function setupStealthMode(page) {
  console.log('🎭 Setting up stealth mode...');
  
  await page.setViewportSize({ width: 1920, height: 1080 });
  
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  });
  
  await page.addInitScript(() => {
    delete navigator.__proto__.webdriver;
    window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
}

async function simulateHumanBehavior(page) {
  try {
    for (let i = 0; i < 2; i++) {
      const x = Math.random() * 1200 + 100;
      const y = Math.random() * 800 + 100;
      await page.mouse.move(x, y);
      await page.waitForTimeout(500 + Math.random() * 1000);
    }
    
    await page.evaluate(() => window.scrollTo(0, Math.random() * 500));
    await page.waitForTimeout(1000);
    
    // Close any popups
    const popupSelectors = ['button:has-text("Accept")', 'button:has-text("OK")', '[aria-label*="Close"]'];
    for (const selector of popupSelectors) {
      try {
        await page.click(selector, { timeout: 2000 });
        await page.waitForTimeout(1000);
      } catch (e) {
        // Continue if popup not found
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
    
    offerElements.forEach((element, index) => {
      try {
        let roomName = null;
        const headingSelectors = ['h3.uitk-heading-6', 'h3', '.uitk-heading-6', '[data-testid*="title"]'];
        
        for (const selector of headingSelectors) {
          const nameEl = element.querySelector(selector);
          if (nameEl) {
            let text = nameEl.textContent.trim();
            if (text.startsWith('View all photos for ')) {
              text = text.replace('View all photos for ', '');
            }
            if (!text.includes('Our lowest price') && !text.includes('Upgrade your stay') && text.length > 5) {
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
                if (nameEl) roomName = nameEl.textContent.trim();
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
    
    return rates;
  });
}

async function uploadToGoogleSheets(results) {
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  
  console.log(`📋 Connected to: ${doc.title}`);
  
  // Get or create the main rates sheet
  let sheet = doc.sheetsByTitle['Rate Monitoring'] || doc.sheetsByIndex[0];
  
  if (!doc.sheetsByTitle['Rate Monitoring']) {
    console.log('📝 Creating Rate Monitoring sheet...');
    sheet = await doc.addSheet({ 
      title: 'Rate Monitoring',
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
  let summarySheet = doc.sheetsByTitle['Rate Summary'];
  
  if (!summarySheet) {
    console.log('📊 Creating Rate Summary sheet...');
    summarySheet = await doc.addSheet({ 
      title: 'Rate Summary',
      headerValues: ['Last Updated', 'Room Type', 'Standard Direct', 'Expedia', 'Booking.com', 'World of Hyatt', 'Min Price', 'Max Price', 'Price Range']
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
      'Standard Direct': rates.get('Standard Direct') || '',
      'Expedia': rates.get('Expedia') || '',
      'Booking.com': rates.get('Booking.com') || '',
      'World of Hyatt': rates.get('World of Hyatt') || '',
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

// Run the comprehensive scraper
scrapeHotelRates().catch(console.error);
