async function extractRoomData(page) {
  return await page.evaluate(() => {
    const rates = [];
    
    // Strategy 1: Look for property offer elements
    const offerElements = document.querySelectorAll('[data-stid^="property-offer"]');
    console.log(`Found ${offerElements.length} property offers`);
    
    offerElements.forEach((element, index) => {
      try {
        // Try multiple selectors for room names
        let roomName = null;
        
        // First, try to get the actual room type heading
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
            
            // Clean up the "View all photos for" prefix
            if (text.startsWith('View all photos for ')) {
              text = text.replace('View all photos for ', '');
            }
            
            // Skip generic labels - we'll handle these separately
            if (!text.includes('Our lowest price') && 
                !text.includes('Upgrade your stay') && 
                text.length > 5) {
              roomName = text;
              break;
            }
          }
        }
        
        // Get price first to help with room type mapping
        const priceEl = element.querySelector('.uitk-type-500, [data-testid*="price"], .uitk-text');
        let price = null;
        
        if (priceEl) {
          const priceMatch = priceEl.textContent.match(/£([\d,]+)/);
          if (priceMatch) {
            price = parseInt(priceMatch[1].replace(',', ''));
          }
        }
        
        // Handle generic room names by looking deeper in the element
        if (!roomName || roomName.includes('Our lowest') || roomName.includes('Upgrade')) {
          // Look for room type info elsewhere in the element
          const allElementText = element.textContent;
          
          // Try to extract room type from the full element text with more specific patterns
          const roomPatterns = [
            /Standard Room[^,\n]*(?:, \d+ \w+ Bed[s]?)?(?:, [^,\n]*)?/i,
            /Deluxe Room[^,\n]*(?:, \d+ \w+ Bed[s]?)?(?:, [^,\n]*)?/i,
            /Premium Room[^,\n]*(?:, \d+ \w+ Bed[s]?)?(?:, [^,\n]*)?/i,
            /Studio Suite[^,\n]*(?:, [^,\n]*)?/i,
            /Suite \([^)]+\)/i,
            /\w+ Suite[^,\n]*(?:, [^,\n]*)?/i,
            /Room[^,\n]*(?:, \d+ \w+ Bed[s]?)?(?:, [^,\n]*)?/i
          ];
          
          for (const pattern of roomPatterns) {
            const match = allElementText.match(pattern);
            if (match) {
              roomName = match[0].trim();
              break;
            }
          }
          
          // Try alternative selectors within the element for room info
          if (!roomName || roomName.includes('Our lowest') || roomName.includes('Upgrade')) {
            const alternativeSelectors = [
              '[data-stid*="content-hotel-title"]',
              '.uitk-text[data-stid*="content"]',
              'span[data-testid*="title"]',
              '.uitk-type-300',
              '.uitk-type-400'
            ];
            
            for (const selector of alternativeSelectors) {
              const altEl = element.querySelector(selector);
              if (altEl) {
                let altText = altEl.textContent.trim();
                if (altText && !altText.includes('Our lowest') && !altText.includes('Upgrade') && 
                    altText.length > 5 && altText.includes('Room')) {
                  roomName = altText;
                  break;
                }
              }
            }
          }
          
          // Final fallback - use generic naming with index
          if (!roomName || roomName.includes('Our lowest') || roomName.includes('Upgrade')) {
            roomName = `Room Option ${index + 1}`;
          }
        }
        
        if (roomName && price && price >= 200 && price <= 3000) {
          rates.push({
            ota: 'Expedia',
            roomName: roomName,
            price: price,
            currency: 'GBP',
            source: 'stealth-extracted'
          });
        }
        
      } catch (e) {
        console.log(`Error processing offer ${index}:`, e.message);
      }
    });
    
    // Strategy 2: Text-based extraction if no structured data
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
    
    // Remove duplicates and sort by price
    const uniqueRates = rates.filter((rate, index, self) =>
      index === self.findIndex(r => r.roomName === rate.roomName && r.price === rate.price)
    ).sort((a, b) => a.price - b.price);
    
    return uniqueRates;
  });
}
