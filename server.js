const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the current directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for game state
const users = {};
const chatMessages = [];
const billboardImages = { '1': null, '2': null, '3': null, '4': null };
const MAX_CHAT_MESSAGES = 50;

// Multer: store uploaded images in memory as base64
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
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

        // Convert to base64 data URL
        const imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        // Store it (paired billboards share the same image)
        const pairs = { '1': '2', '2': '1', '3': '4', '4': '3' };
        billboardImages[billboardId] = imageData;
        billboardImages[pairs[billboardId]] = imageData;

        // Broadcast to all clients
        io.emit('billboard-updated', { billboardId: billboardId, imageData: imageData });
        io.emit('billboard-updated', { billboardId: pairs[billboardId], imageData: imageData });

        res.json({ success: true });
    } catch (error) {
        console.error('Upload error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('user-joined', (data) => {
        // Register the user
        users[socket.id] = {
            id: socket.id,
            username: data.username || 'Unknown',
            avatarType: data.avatarType || 'selena2',
            position: data.position || { x: 0, y: 0, z: 0 },
            rotation: data.rotation || { x: 0, y: 0, z: 0 }
        };

        console.log(`${data.username} joined with avatar ${data.avatarType}`);

        // Send existing state to the new user
        socket.emit('init-data', {
            chatMessages: chatMessages,
            billboardImages: billboardImages
        });

        // Add a system message
        const joinMessage = {
            type: 'system',
            message: `${data.username} joined the world`,
            timestamp: Date.now()
        };
        chatMessages.push(joinMessage);
        if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
        io.emit('chat-message', joinMessage);

        // Broadcast updated user list to everyone
        io.emit('user-list-updated', users);
    });

    socket.on('user-moved', (data) => {
        if (users[socket.id]) {
            users[socket.id].position = data.position;
            users[socket.id].rotation = data.rotation;
            // Broadcast movement to everyone except sender
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
