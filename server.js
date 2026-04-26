const express = require("express");
const app = express();

app.use(express.static("."));

const http = require("http").createServer(app);
const io = require("socket.io")(http);

const PORT = 8080;
http.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// seats[seatId] = null | { occupant: socketId, color: '#rrggbb' }
const TOTAL_SEATS = 16;
const seats = {};
for (let i = 1; i <= TOTAL_SEATS; i++) seats[i] = null;

// reverse lookup: socketId → seatId
const socketToSeat = {};

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // send full snapshot so the new client can render existing chairs
  socket.emit("seatState", seats);

  socket.on("claimSeat", ({ seatId, color }) => {
    seatId = Number(seatId);
    if (!seats.hasOwnProperty(seatId)) return;

    if (seats[seatId] !== null) {
      socket.emit("seatDenied", { seatId });
      return;
    }

    // release any seat this socket previously held
    const prev = socketToSeat[socket.id];
    if (prev) {
      seats[prev] = null;
      io.emit("seatReleased", { seatId: prev });
    }

    seats[seatId] = { occupant: socket.id, color };
    socketToSeat[socket.id] = seatId;
    console.log(`seat ${seatId} claimed by ${socket.id} (${color})`);
    io.emit("seatClaimed", { seatId, occupant: socket.id, color });
  });

  socket.on("disconnect", () => {
    console.log("disconnected:", socket.id);
    const seatId = socketToSeat[socket.id];
    if (seatId) {
      seats[seatId] = null;
      delete socketToSeat[socket.id];
      io.emit("seatReleased", { seatId });
    }
  });
});
