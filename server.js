const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the public directory (no caching, so edits always show immediately)
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
}));

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// In-memory storage for game state
const users = {};
const chatMessages = [];
const billboardImages = { '1': null, '2': null, '3': null, '4': null };
const MAX_CHAT_MESSAGES = 50;

// Multer: store uploaded images in memory as base64
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Billboard upload endpoint
app.post('/upload-billboard', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, error: 'No file uploaded' });
        }
        const billboardId = req.body.billboardId;
        if (!['1', '2', '3', '4'].includes(billboardId)) {
            return res.json({ success: false, error: 'Invalid billboard ID' });
        }

        const imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        const pairs = { '1': '2', '2': '1', '3': '4', '4': '3' };
        billboardImages[billboardId] = imageData;
        billboardImages[pairs[billboardId]] = imageData;

        io.emit('billboard-updated', { billboardId: billboardId, imageData: imageData });
        io.emit('billboard-updated', { billboardId: pairs[billboardId], imageData: imageData });

        res.json({ success: true });
    } catch (error) {
        console.error('Upload error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.get('/version-check', (req, res) => {
    res.send('VERSION MARKER: pond-y3-test-12345');
});

// Reset endpoint - visit /reset to clear all session data
app.get('/reset', (req, res) => {
    Object.keys(users).forEach(k => delete users[k]);
    chatMessages.length = 0;
    Object.keys(billboardImages).forEach(k => billboardImages[k] = null);
    io.emit('user-list-updated', users);
    io.emit('init-data', { chatMessages: [], billboardImages });
    res.send('World reset! All chat, billboards and users cleared.');
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('user-joined', (data) => {
        users[socket.id] = {
            id: socket.id,
            username: data.username || 'Unknown',
            avatarType: data.avatarType || 'selena2',
            position: data.position || { x: 0, y: 0, z: 0 },
            rotation: data.rotation || { x: 0, y: 0, z: 0 }
        };

        console.log(`${data.username} joined with avatar ${data.avatarType}`);

        socket.emit('init-data', {
            chatMessages: chatMessages,
            billboardImages: billboardImages
        });

        const joinMessage = {
            type: 'system',
            message: `${data.username} joined the world`,
            timestamp: Date.now()
        };
        chatMessages.push(joinMessage);
        if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
        io.emit('chat-message', joinMessage);

        io.emit('user-list-updated', users);
    });

    socket.on('user-moved', (data) => {
        if (users[socket.id]) {
            users[socket.id].position = data.position;
            users[socket.id].rotation = data.rotation;
            socket.broadcast.emit('user-moved', {
                userId: socket.id,
                position: data.position,
                rotation: data.rotation
            });
        }
    });

    socket.on('my-avatar-updated', (data) => {
        if (users[socket.id]) {
            users[socket.id].avatarType = data.avatarType;
            io.emit('user-list-updated', users);
        }
    });

    socket.on('chat-message', (data) => {
        if (!users[socket.id]) return;
        const message = {
            type: 'chat',
            username: users[socket.id].username,
            message: data.message,
            timestamp: Date.now()
        };
        chatMessages.push(message);
        if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
        io.emit('chat-message', message);
    });

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            const username = users[socket.id].username;
            console.log(`${username} disconnected`);

            const leaveMessage = {
                type: 'system',
                message: `${username} left the world`,
                timestamp: Date.now()
            };
            chatMessages.push(leaveMessage);
            if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();

            delete users[socket.id];

            io.emit('chat-message', leaveMessage);
            io.emit('user-left', socket.id);
            io.emit('user-list-updated', users);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`3D Virtual World server running on port ${PORT}`);
});
