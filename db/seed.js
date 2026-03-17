require('dotenv').config();
const { query, pool } = require('./pool');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');

const seed = async () => {
  console.log('🌱 Seeding PostgreSQL database...');

  // Wipe existing data
  await query(`TRUNCATE TABLE refresh_tokens, order_items, orders, inventory,
    restaurant_tables, menu_item_tags, customization_options,
    menu_item_customizations, menu_items, categories, users, restaurants
    RESTART IDENTITY CASCADE`);
  console.log('🧹 All tables wiped');

  // 1. Restaurant
  const { rows: [restaurant] } = await query(`
    INSERT INTO restaurants (name, phone, address, email, subscription_plan,
      settings_currency, settings_timezone, settings_tax_percentage, settings_service_charge)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    ['Spice Garden Restaurant', '+91 98765 43210',
     'MG Road, Tirupati, Andhra Pradesh', 'info@spicegarden.com',
     'premium', '₹', 'Asia/Kolkata', 5, 0]
  );
  console.log(`🏪 Restaurant: ${restaurant.name} (${restaurant.id})`);

  // 2. Users
  const hash = await bcrypt.hash('password123', 12);
  const { rows: users } = await query(`
    INSERT INTO users (restaurant_id, name, email, password, role) VALUES
      ($1,'Ravi Kumar',  'owner@spicegarden.com',   $2,'owner'),
      ($1,'Priya Sharma','waiter@spicegarden.com',  $2,'waiter'),
      ($1,'Chef Anand',  'kitchen@spicegarden.com', $2,'kitchen')
    RETURNING id, name, role`,
    [restaurant.id, hash]
  );
  console.log(`👥 Users: ${users.map(u => u.role).join(', ')}`);

  // 3. Categories
  const cats = ['Starters','Main Course','Breads','Rice & Biryani','Desserts','Beverages'];
  const { rows: categories } = await query(`
    INSERT INTO categories (restaurant_id, name, sort_order)
    SELECT $1, name, idx FROM UNNEST($2::text[], ARRAY[1,2,3,4,5,6]) AS t(name,idx)
    RETURNING id, name`,
    [restaurant.id, cats]
  );
  const catMap = Object.fromEntries(categories.map(c => [c.name, c.id]));
  console.log(`📂 ${categories.length} categories`);

  // 4. Menu Items
  const items = [
    // Starters
    { cat:'Starters',      name:'Paneer Tikka',        price:280, veg:true,  desc:'Grilled cottage cheese marinated in spices',      time:15, tags:['popular','spicy'] },
    { cat:'Starters',      name:'Veg Spring Rolls',     price:180, veg:true,  desc:'Crispy rolls with fresh vegetables',               time:10, tags:[] },
    { cat:'Starters',      name:'Chicken Tikka',        price:320, veg:false, desc:'Tender chicken pieces cooked in tandoor',          time:20, tags:['bestseller'] },
    { cat:'Starters',      name:'Fish Fry',             price:350, veg:false, desc:'Spiced crispy fried fish',                         time:15, tags:[] },
    { cat:'Starters',      name:'Hara Bhara Kabab',     price:200, veg:true,  desc:'Spinach and pea patties grilled to perfection',    time:12, tags:['healthy'] },
    // Main Course
    { cat:'Main Course',   name:'Butter Chicken',       price:380, veg:false, desc:'Creamy tomato-based chicken curry',                time:20, tags:['bestseller'] },
    { cat:'Main Course',   name:'Paneer Butter Masala', price:320, veg:true,  desc:'Rich cottage cheese in butter sauce',              time:15, tags:['popular'] },
    { cat:'Main Course',   name:'Dal Makhani',          price:260, veg:true,  desc:'Slow cooked black lentils with cream',             time:10, tags:[] },
    { cat:'Main Course',   name:'Mutton Rogan Josh',    price:450, veg:false, desc:'Aromatic Kashmiri lamb curry',                     time:25, tags:['spicy'] },
    { cat:'Main Course',   name:'Palak Paneer',         price:290, veg:true,  desc:'Cottage cheese in creamy spinach gravy',           time:15, tags:['healthy'] },
    { cat:'Main Course',   name:'Chicken Kadai',        price:360, veg:false, desc:'Chicken cooked with bell peppers and spices',      time:20, tags:['spicy'] },
    // Breads
    { cat:'Breads',        name:'Butter Naan',          price:60,  veg:true,  desc:'Soft leavened bread with butter',                  time:5,  tags:['popular'] },
    { cat:'Breads',        name:'Garlic Naan',          price:80,  veg:true,  desc:'Naan topped with garlic and herbs',                time:5,  tags:[] },
    { cat:'Breads',        name:'Tandoori Roti',        price:40,  veg:true,  desc:'Whole wheat bread from tandoor',                   time:5,  tags:[] },
    { cat:'Breads',        name:'Stuffed Paratha',      price:100, veg:true,  desc:'Wheat bread stuffed with spiced potato',           time:8,  tags:[] },
    // Rice & Biryani
    { cat:'Rice & Biryani',name:'Chicken Biryani',      price:380, veg:false, desc:'Aromatic basmati rice with spiced chicken',        time:25, tags:['bestseller'] },
    { cat:'Rice & Biryani',name:'Veg Biryani',          price:280, veg:true,  desc:'Fragrant rice with mixed vegetables',              time:20, tags:[] },
    { cat:'Rice & Biryani',name:'Jeera Rice',           price:160, veg:true,  desc:'Basmati rice tempered with cumin',                 time:10, tags:[] },
    { cat:'Rice & Biryani',name:'Mutton Biryani',       price:480, veg:false, desc:'Dum cooked mutton with basmati rice',              time:30, tags:['popular'] },
    // Desserts
    { cat:'Desserts',      name:'Gulab Jamun',          price:120, veg:true,  desc:'Soft milk dumplings in sugar syrup',               time:5,  tags:[] },
    { cat:'Desserts',      name:'Kulfi',                price:140, veg:true,  desc:'Traditional Indian ice cream',                     time:5,  tags:[] },
    { cat:'Desserts',      name:'Rasgulla',             price:110, veg:true,  desc:'Soft cottage cheese balls in syrup',               time:5,  tags:[] },
    // Beverages
    { cat:'Beverages',     name:'Lassi',                price:120, veg:true,  desc:'Fresh yogurt drink',                               time:5,  tags:[], customizations:[{ name:'Type', required:true, options:['Sweet','Salted','Mango'] }] },
    { cat:'Beverages',     name:'Masala Chai',          price:60,  veg:true,  desc:'Spiced Indian tea',                                time:5,  tags:[] },
    { cat:'Beverages',     name:'Fresh Lime Soda',      price:80,  veg:true,  desc:'Refreshing lime soda',                             time:3,  tags:[] },
    { cat:'Beverages',     name:'Mango Shake',          price:150, veg:true,  desc:'Thick fresh mango milkshake',                      time:5,  tags:['popular'] },
  ];

  const menuIds = [];
  for (const item of items) {
    const { rows: [mi] } = await query(`
      INSERT INTO menu_items (restaurant_id, category_id, name, description, price, is_veg, preparation_time)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [restaurant.id, catMap[item.cat], item.name, item.desc, item.price, item.veg, item.time]
    );
    menuIds.push({ id: mi.id, ...item });

    if (item.tags?.length) {
      for (const tag of item.tags) {
        await query(`INSERT INTO menu_item_tags (menu_item_id, tag) VALUES ($1,$2)`, [mi.id, tag]);
      }
    }
    if (item.customizations?.length) {
      for (let ci = 0; ci < item.customizations.length; ci++) {
        const c = item.customizations[ci];
        const { rows: [cr] } = await query(
          `INSERT INTO menu_item_customizations (menu_item_id, name, is_required, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`,
          [mi.id, c.name, c.required, ci]
        );
        for (let oi = 0; oi < c.options.length; oi++) {
          await query(`INSERT INTO customization_options (customization_id, option_value, sort_order) VALUES ($1,$2,$3)`,
            [cr.id, c.options[oi], oi]);
        }
      }
    }
  }
  console.log(`🍽️  ${menuIds.length} menu items`);

  // 5. Tables with QR codes
  const tableData = [
    { number:'T1',capacity:2 }, { number:'T2',capacity:2 },
    { number:'T3',capacity:4 }, { number:'T4',capacity:4 },
    { number:'T5',capacity:4 }, { number:'T6',capacity:4 },
    { number:'T7',capacity:6 }, { number:'T8',capacity:6 },
    { number:'T9',capacity:8 }, { number:'T10',capacity:8 },
  ];
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
  const tableRows = [];
  for (const t of tableData) {
    const { rows: [tbl] } = await query(
      `INSERT INTO restaurant_tables (restaurant_id, table_number, capacity) VALUES ($1,$2,$3) RETURNING id`,
      [restaurant.id, t.number, t.capacity]
    );
    const qrData = `${CLIENT_URL}/menu/${restaurant.id}/${tbl.id}`;
    const qrUrl  = await QRCode.toDataURL(qrData, { errorCorrectionLevel:'H', width:300 });
    await query(`UPDATE restaurant_tables SET qr_code_url=$2, qr_data=$3 WHERE id=$1`, [tbl.id, qrUrl, qrData]);
    tableRows.push({ id: tbl.id, number: t.number });
  }
  console.log(`🪑 ${tableRows.length} tables with QR codes`);

  // 6. Inventory
  const inv = [
    ['Chicken','kg',20,5], ['Mutton','kg',10,3], ['Paneer','kg',15,4],
    ['Basmati Rice','kg',50,10], ['Wheat Flour','kg',30,8],
    ['Cooking Oil','liters',20,5], ['Milk','liters',10,3],
    ['Tomatoes','kg',8,2], ['Onions','kg',15,4], ['Butter','kg',5,2],
  ];
  for (const [name, unit, cur, min] of inv) {
    await query(`INSERT INTO inventory (restaurant_id, name, unit, current_stock, minimum_stock) VALUES ($1,$2,$3,$4,$5)`,
      [restaurant.id, name, unit, cur, min]);
  }
  console.log(`📦 ${inv.length} inventory items`);

  // 7. Sample Orders
  const [t1, t2] = tableRows;
  const [i1, , i3] = menuIds; // Paneer Tikka, Chicken Tikka
  const [, i2, , i4] = menuIds; // Veg Spring Rolls, Fish Fry

  const orderNum1 = `ORD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-0001`;
  const total1 = i1.price * 2 + i3.price;
  const tax1   = Math.round(total1 * 0.05);
  const { rows: [order1] } = await query(`
    INSERT INTO orders (restaurant_id, table_id, table_number, status,
      total_amount, tax_amount, grand_total, payment_status, payment_method, order_number)
    VALUES ($1,$2,$3,'delivered',$4,$5,$6,'paid','upi',$7) RETURNING id`,
    [restaurant.id, t1.id, t1.number, total1, tax1, total1 + tax1, orderNum1]
  );
  await query(`INSERT INTO order_items (order_id, menu_item_id, name, price, quantity) VALUES ($1,$2,$3,$4,2),($1,$5,$6,$7,1)`,
    [order1.id, i1.id, i1.name, i1.price, i3.id, i3.name, i3.price]);

  const orderNum2 = `ORD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-0002`;
  const total2 = i2.price + i4.price * 2;
  const tax2   = Math.round(total2 * 0.05);
  const { rows: [order2] } = await query(`
    INSERT INTO orders (restaurant_id, table_id, table_number, status,
      total_amount, tax_amount, grand_total, payment_status, order_number)
    VALUES ($1,$2,$3,'preparing',$4,$5,$6,'pending',$7) RETURNING id`,
    [restaurant.id, t2.id, t2.number, total2, tax2, total2 + tax2, orderNum2]
  );
  await query(`INSERT INTO order_items (order_id, menu_item_id, name, price, quantity) VALUES ($1,$2,$3,$4,1),($1,$5,$6,$7,2)`,
    [order2.id, i2.id, i2.name, i2.price, i4.id, i4.name, i4.price]);

  await query(`UPDATE restaurant_tables SET status='occupied', current_order_id=$2 WHERE id=$1`, [t2.id, order2.id]);
  console.log('🧾 2 sample orders');

  console.log(`
╔══════════════════════════════════════════════════════╗
║          ✅  SEED COMPLETE (PostgreSQL)              ║
╠══════════════════════════════════════════════════════╣
║  🏪 Spice Garden Restaurant                          ║
║  LOGIN CREDENTIALS  (password: password123)          ║
║  👑 owner@spicegarden.com                            ║
║  🛎  waiter@spicegarden.com                          ║
║  🍳 kitchen@spicegarden.com                          ║
╠══════════════════════════════════════════════════════╣
║  📂 Categories : 6    🍽️  Items : 26                 ║
║  🪑 Tables     : 10   📦 Inventory : 10              ║
╚══════════════════════════════════════════════════════╝
  `);
  await pool.end();
};

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
