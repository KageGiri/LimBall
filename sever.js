require('dotenv').config(); // Lấy chìa khóa mở két sắt .env
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose'); // Gọi thư viện Database

const app = express();
const PORT = process.env.PORT || 3000; // Lấy PORT từ két sắt

// --- MIDDLEWARE (Lớp bảo vệ và lọc dữ liệu) ---
app.use(cors());
app.use(express.json());

// --- KẾT NỐI DATABASE (Đường ống dẫn dữ liệu) ---

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Đã kết nối thành công với MongoDB!"))
    .catch((err) => console.log("❌ Lỗi kết nối Database:", err));

// --- KHUÔN ĐÚC DỮ LIỆU (Mongoose Schema) ---
const ballSchema = new mongoose.Schema({
    race: String,
    weapon: String,
    stats: {
        atk: Number, hp: Number, iq: Number,
        mp: Number, speed: Number, weapon_mastery: Number
    },
    createdAt: { type: Date, default: Date.now } // Tự động ghi nhớ thời gian quay được
});

// Tạo Model từ khuôn đúc trên (MongoDB sẽ tự tạo một bảng tên là 'balls')
const Ball = mongoose.model('Ball', ballSchema);
// --- DỮ LIỆU TẠM THỜI ---
const races = ["Human", "Elf", "Orc", "Dragonborn", "Dwarf"];
const weapons = ["Sword", "Spear", "Bow", "Staff", "Hammer"];

// --- ROUTES (Các cánh cửa API) ---

// Cửa 1: Kiểm tra sức khỏe Server
app.get('/', (req, res) => {
    res.send("Máy chủ Gacha đang hoạt động ổn định!");
});

// Cửa 2: Cỗ máy Gacha
app.get('/api/roll', (req, res) => {
    const getRandom = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    let stats = {
        atk: getRandom(1, 10), hp: getRandom(1, 10),
        iq: getRandom(1, 10), mp: getRandom(1, 10),
        speed: getRandom(1, 10), weapon_mastery: getRandom(1, 10)
    };

    const newBall = {
        race: races[Math.floor(Math.random() * races.length)],
        weapon: weapons[Math.floor(Math.random() * weapons.length)],
        stats: stats
    };

    res.json(newBall);
});
// --- Cửa 3: Nhận bóng từ Frontend và Lưu vào Database (POST) ---
app.post('/api/save-ball', async (req, res) => {
    try {
        const ballData = req.body; // Lấy cục dữ liệu Frontend gửi lên
        
        // Nhét dữ liệu vào khuôn đúc
        const newBall = new Ball(ballData); 
        
        // Cất vào kho (Lệnh await nghĩa là bắt server chờ lưu xong mới chạy tiếp)
        await newBall.save(); 
        
        // Trả lời lại cho Frontend biết đã lưu thành công
        res.json({ message: "Đã lưu bóng vào kho thành công!", data: newBall });
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi lưu bóng", error: error.message });
    }
});

// --- Cửa 4: Mở kho đồ xem danh sách bóng đang có (GET) ---
app.get('/api/inventory', async (req, res) => {
    try {
        const myBalls = await Ball.find(); // Lệnh find() lấy toàn bộ bóng trong kho
        res.json(myBalls);
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi mở kho đồ", error: error.message });
    }
});
// --- KHỞI ĐỘNG SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
});
