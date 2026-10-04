import express, { json } from 'express';
import cors from 'cors';
const app = express();

// Middlewares
app.use(cors()); // Para que no te tire error de CORS el frontend
app.use(json()); // Para leer el JSON que manda tu Next.js

// Simulamos el POST que hace tu action de Next.js
app.post('/api/Productos', (req, res) => {
    const payload = req.body;
    
    console.log("📦 Nuevo producto recibido:", payload);

    // Simulamos que la base de datos le genera un ID numérico
    const idGenerado = Math.floor(Math.random() * 1000) + 1; 

    // Devolvemos el mismo objeto que enviaste, pero con el ID agregado
    res.status(201).json({
        ...payload,
        id_producto: idGenerado
    });
});

// Endpoint de prueba para saber si está vivo
app.get('/', (req, res) => {
    res.send('Mock API del Kiosco funcionando 🚀');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor de prueba corriendo en el puerto ${PORT}`);
});