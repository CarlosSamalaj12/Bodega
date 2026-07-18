// server-lib/auth.js  —  JWT auth middleware, Socket.IO auth, event emitter
import jwt from "jsonwebtoken";
import { io } from "./core.js";

function signToken(user) {
  return jwt.sign(
    { id_user: user.id_user, id_role: user.id_role, id_warehouse: user.id_warehouse, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const qt = req.query && req.query.token ? String(req.query.token) : "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (qt || null);
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalido" });
  }
}

io.use((socket, next) => {
  try {
    const authToken = socket.handshake?.auth?.token ? String(socket.handshake.auth.token) : "";
    const queryToken = socket.handshake?.query?.token ? String(socket.handshake.query.token) : "";
    const token = authToken || queryToken;
    if (!token) return next(new Error("No token"));
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = payload;
    next();
  } catch {
    next(new Error("Token invalido"));
  }
});

io.on("connection", (socket) => {
  const idWarehouse = Number(socket.user?.id_warehouse || 0);
  if (idWarehouse > 0) socket.join(`warehouse:${idWarehouse}`);
});

function emitPedidoChanged(payload) {
  const reqWh = Number(payload?.requester_warehouse_id || 0);
  const fromWh = Number(payload?.requested_from_warehouse_id || 0);
  const envelope = {
    id_pedido: Number(payload?.id_pedido || 0),
    requester_warehouse_id: reqWh || null,
    requested_from_warehouse_id: fromWh || null,
    status: String(payload?.status || "").toUpperCase() || null,
    action: payload?.action || "updated",
    at: new Date().toISOString(),
  };
  if (reqWh > 0) io.to(`warehouse:${reqWh}`).emit("pedido:changed", envelope);
  if (fromWh > 0) io.to(`warehouse:${fromWh}`).emit("pedido:changed", envelope);
}

export { signToken, auth, emitPedidoChanged };
