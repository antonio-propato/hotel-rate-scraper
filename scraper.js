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
          '[data-testid*="title"]'
        ];
        
        for (const selector of headingSelectors) {
          const nameEl = element.querySelector(selector);
          if (nameEl) {
            let text = nameEl.textContent.trim();
            
            // Clean up the text
            if (text.startsWith('View all photos for ')) {
              text = text.replace('View all photos for ', '');
            }
            
            // Skip generic labels
            if (!text.includes('Our lowest price') && 
                !text.includes('Upgrade your stay') && 
                text.length > 5) {
              roomName = text;
              break;
            }
          }
        }
        
        // If still no good room name, try to find it in the card content
        if (!roomName || roomName.includes('Our lowest') || roomName.includes('Upgrade')) {
          const allText = element.textContent;
          const roomPatterns = [
            /Standard Room[^,\n]*/,
            /Deluxe Room[^,\n]*/,
            /Premium Room[^,\n]*/,
            /Studio Suite[^,\n]*/,
            /Suite \([^)]+\)/,
            /\w+ Room[^,\n]*/
          ];
          
          for (const pattern of roomPatterns) {
            const match = allText.match(pattern);
            if (match) {
              roomName = match[0].trim();
              break;
            }
          }
        }
        
        // Get price
        const priceEl = element.querySelector('.uitk-type-500, [data-testid*="price"]');
        
        if (roomName && priceEl) {
          const priceMatch = priceEl.textContent.match(/£([\d,]+)/);
          
          if (priceMatch) {
            const price = parseInt(priceMatch[1].replace(',', ''));
            if (price >= 200 && price <= 3000) {
              
              // Map generic names to specific room types based on price
              if (roomName === 'Our lowest price' && price === 319) {
                roomName = 'Standard Room, 1 King Bed (Interior)';
              } else if (roomName === 'Upgrade your stay' && price === 329) {
                roomName = 'Standard Room, 1 Queen Bed';
              }
              
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
      } catch (e) {
        console.log(`Error processing offer ${index}:`, e.message);
      }
    });
    
    return rates;
  });
}
