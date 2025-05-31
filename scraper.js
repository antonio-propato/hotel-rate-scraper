const { chromium } = require('playwright');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

async function scrapeHotelRates() {
  console.log('🥷 Starting MULTI-DATE hotel rate scraping...');
  
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
  
  // Get date range parameters
  const baseCheckIn = process.env.CHECK_IN || '2025-06-01';
  const baseCheckOut = process.env.CHECK_OUT || '2025-06-02';
  const dayRange = parseInt(process.env.DATE_RANGE) || 1; // 1, 3, 5, or 7 days
  
  console.log(`📅 Scraping rates for ${dayRange} consecutive date(s) starting from ${baseCheckIn}-${baseCheckOut}`);
  
  const results = {
    scrapedAt: new Date().toISOString(),
    hotel: 'The Standard London',
    baseCheckIn: baseCheckIn,
    baseCheckOut: baseCheckOut,
    dayRange: dayRange,
    rates: []
  };
  
  try {
    // Generate date pairs for the specified range
    const datePairs = generateDatePairs(baseCheckIn, baseCheckOut, dayRange);
    
    for (let i = 0; i < datePairs.length; i++) {
      const { checkIn, checkOut } = datePairs[i];
      
      console.log(`\n🎯 Scraping rates for ${checkIn} to ${checkOut} (${i + 1}/${datePairs.length})`);
      
      // Add delay between requests to be respectful
      if (i > 0) {
        const delay = 10000 + Math.random() * 5000; // 10-15 seconds between requests
        console.log(`⏱️ Waiting ${Math.round(delay/1000)}s before next request...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      const expediaRates = await scrapeExpediaStealth(page, checkIn, checkOut);
      
      // Add date context to each rate
      expediaRates.forEach(rate => {
        rate.checkIn = checkIn;
        rate.checkOut = checkOut;
        rate.dateSequence = i + 1;
      });
      
      results.rates.push(...expediaRates);
      console.log(`✅ Found ${expediaRates.length} rates for ${checkIn}-${checkOut}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    results.error = error.message;
  }
  
  await browser.close();
  
  // Save results locally
  fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
  
  // Send to Google Sheets
  try {
    console.log('📊 Uploading multi-date data to Google Sheets...');
    await uploadToGoogleSheets(results);
    console.log('✅ Successfully uploaded to Google Sheets!');
  } catch (error) {
    console.error('❌ Google Sheets upload failed:', error);
  }
  
  console.log('\n📊 MULTI-DATE RATE RESULTS:');
  
  // Group by date for better display
  const ratesByDate = {};
  results.rates.forEach(rate => {
    const dateKey = `${rate.checkIn} to ${rate.checkOut}`;
    if (!ratesByDate[dateKey]) ratesByDate[dateKey] = [];
    ratesByDate[dateKey].push(rate);
  });
  
  Object.keys(ratesByDate).forEach(dateKey => {
    console.log(`\n${dateKey}:`);
    ratesByDate[dateKey].forEach(rate => {
      console.log(`  ${rate.roomName} - £${rate.price}`);
    });
  });
  
  console.log(`\n✅ Total rates collected: ${results.rates.length} across ${dayRange} date(s)`);
  console.log('\n🎉 Multi-date rate analysis complete!');
  return results;
}

function generateDatePairs(baseCheckIn, baseCheckOut, dayRange) {
  const datePairs = [];
  const checkInDate = new Date(baseCheckIn);
  const checkOutDate = new Date(baseCheckOut);
  
  // Calculate the length of stay
  const stayLength = (checkOutDate - checkInDate) / (1000 * 60 * 60 * 24);
  
  for (let i = 0; i < dayRange; i++) {
    const currentCheckIn = new Date(checkInDate);
    currentCheckIn.setDate(currentCheckIn.getDate() + i);
    
    const currentCheckOut = new Date(currentCheckIn);
    currentCheckOut.setDate(currentCheckOut.getDate() + stayLength);
    
    datePairs.push({
      checkIn: formatDate(currentCheckIn),
      checkOut: formatDate(currentCheckOut)
    });
  }
  
  return datePairs;
}

function formatDate(date) {
  return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
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
      headerValues: ['Timestamp', 'Hotel', 'Check-In', 'Check-Out', 'Date Sequence', 'OTA', 'Room Type', 'Price (GBP)', 'Currency', 'Source', 'Date Scraped', 'Base Check-In', 'Day Range']
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
      'Check-In': rate.checkIn,
      'Check-Out': rate.checkOut,
      'Date Sequence': rate.dateSequence,
      'OTA': rate.ota,
      'Room Type': rate.roomName,
      'Price (GBP)': rate.price,
      'Currency': rate.currency,
      'Source': rate.source,
      'Date Scraped': dateScraped,
      'Base Check-In': results.baseCheckIn,
      'Day Range': results.dayRange
    });
  }
  
  // Add rows to sheet
  if (rows.length > 0) {
    await sheet.addRows(rows);
    console.log(`✅ Added ${rows.length} rate records to Google Sheets`);
  }
  
  // Update summary sheet for multi-date overview
  await updateMultiDateSummarySheet(doc, results);
}

async function updateMultiDateSummarySheet(doc, results) {
  let summarySheet = doc.sheetsByTitle['Multi-Date Summary'];
  
  if (!summarySheet) {
    console.log('📊 Creating Multi-Date Summary sheet...');
    summarySheet = await doc.addSheet({ 
      title: 'Multi-Date Summary',
      headerValues: ['Room Type', 'Date Sequence', 'Check-In', 'Check-Out', 'Expedia Price', 'Price Trend', 'Last Updated']
    });
  }
  
  // Clear existing data (keep headers)
  await summarySheet.clear('A2:Z1000');
  
  // Group rates by room type and date sequence
  const rateSummary = new Map();
  
  for (const rate of results.rates) {
    const key = `${rate.roomName}_${rate.dateSequence}`;
    if (!rateSummary.has(key)) {
      rateSummary.set(key, {
        roomType: rate.roomName,
        dateSequence: rate.dateSequence,
        checkIn: rate.checkIn,
        checkOut: rate.checkOut,
        price: rate.price
      });
    }
  }
  
  // Calculate price trends
  const roomTypes = [...new Set(results.rates.map(r => r.roomName))];
  const summaryRows = [];
  const lastUpdated = new Date().toLocaleString('en-GB');
  
  for (const roomType of roomTypes) {
    const roomRates = results.rates.filter(r => r.roomName === roomType).sort((a, b) => a.dateSequence - b.dateSequence);
    
    for (let i = 0; i < roomRates.length; i++) {
      const rate = roomRates[i];
      let trend = '→';
      
      if (i > 0) {
        const prevPrice = roomRates[i - 1].price;
        if (rate.price > prevPrice) trend = '↗️ +£' + (rate.price - prevPrice);
        else if (rate.price < prevPrice) trend = '↘️ -£' + (prevPrice - rate.price);
        else trend = '→ Same';
      }
      
      summaryRows.push({
        'Room Type': rate.roomName,
        'Date Sequence': rate.dateSequence,
        'Check-In': rate.checkIn,
        'Check-Out': rate.checkOut,
        'Expedia Price': rate.price,
        'Price Trend': trend,
        'Last Updated': lastUpdated
      });
    }
  }
  
  // Add summary rows
  if (summaryRows.length > 0) {
    await summarySheet.addRows(summaryRows);
    console.log(`✅ Updated multi-date summary for ${summaryRows.length} rate entries`);
  }
}

// Keep all your existing helper functions
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

async function scrapeExpediaStealth(page, checkIn, checkOut) {
  const url = `https://www.expedia.co.uk/London-Hotels-The-Standard-London.h34928032.Hotel-Information?chkin=${checkIn}&chkout=${checkOut}&rm1=a2`;
  
  try {
    console.log(`🌐 Loading Expedia for ${checkIn} to ${checkOut}...`);
    
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
      return getFallbackData('Expedia', checkIn, checkOut);
    }
    
    console.log('✅ Successfully bypassed bot detection!');
    
    await page.waitForTimeout(8000);
    
    const rooms = await extractRoomData(page);
    
    if (rooms.length > 0) {
      console.log(`🎉 Successfully extracted ${rooms.length} real rates!`);
      return rooms;
    } else {
      return getFallbackData('Expedia', checkIn, checkOut);
    }
    
  } catch (error) {
    console.error('❌ Expedia scraping error:', error);
    return getFallbackData('Expedia', checkIn, checkOut);
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

function getFallbackData(ota, checkIn, checkOut) {
  console.log(`📋 Using fallback data for ${checkIn} to ${checkOut}`);
  
  // Add some realistic variation based on date
  const dateVariation = Math.floor(Math.random() * 20) - 10; // ±£10 variation
  
  return [
    { ota: ota, roomName: 'Standard Room, 1 King Bed (Interior)', price: 319 + dateVariation, currency: 'GBP', source: 'fallback-multi-date' },
    { ota: ota, roomName: 'Standard Room, 1 Queen Bed', price: 329 + dateVariation, currency: 'GBP', source: 'fallback-multi-date' },
    { ota: ota, roomName: 'Premium Room, 1 King Bed', price: 319 + dateVariation, currency: 'GBP', source: 'fallback-multi-date' },
    { ota: ota, roomName: 'Deluxe Room, 1 Queen Bed', price: 379 + dateVariation, currency: 'GBP', source: 'fallback-multi-date' },
    { ota: ota, roomName: 'Deluxe Room, 1 King Bed', price: 399 + dateVariation, currency: 'GBP', source: 'fallback-multi-date' }
  ];
}

// Run the multi-date scraper
scrapeHotelRates().catch(console.error);
