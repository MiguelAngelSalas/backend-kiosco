import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from "bcrypt" // Arriba de todo en tu index.js


// 1. Cargamos las variables de entorno ANTES que nada
dotenv.config();

const { Pool } = pg;
const app = express();

app.use(cors());
app.use(express.json());

// 2. EL CHISMOSO (Tiene que ir antes de las rutas para capturar todo)
app.use((req, res, next) => {
    console.log(`👀 Petición entrante: ${req.method} ${req.url}`);
    next();
});

const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    // El token viene como "Bearer eyJhbGci..." así que lo separamos
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        console.log("❌ Acceso bloqueado: No se envió token");
        return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
    }

    // Usamos jwt.verify (con el jwt. adelante porque usamos ES Modules)
    jwt.verify(token, process.env.JWT_SECRET || 'secreto_kiosco_super_seguro', (err, user) => {
        if (err) {
            console.log("❌ Acceso bloqueado: Token inválido o vencido");
            return res.status(403).json({ error: 'Token inválido o expirado.' });
        }
        
        req.user = user; // Guardamos los datos del usuario por si la ruta los necesita
        next(); // Le da luz verde para pasar a la ruta (ej: a crear la categoría)
    });
};

// 3. RUTA PRINCIPAL (Para verificar que el servidor está vivo desde el navegador)
app.get('/', (req, res) => {
    res.send('🚀 El Backend del Kiosco está funcionando perfecto y conectado!');
});

// 4. Conexión a Neon PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// GET: Traer todos los productos
app.get('/api/Productos', verificarToken, async (req, res) => {
    try {
        // 1. Identificamos qué kiosco está pidiendo la lista
        const id_negocio = req.user.id_negocio;

        // 2. Traemos SOLO los productos de ese kiosco en particular
        const result = await pool.query(
            'SELECT * FROM productos WHERE id_negocio = $1', 
            [id_negocio]
        );
        
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Error al traer productos:", err.message);
        res.status(500).json({ error: "Error al obtener los productos" });
    }
});

// GET: Buscar producto por CÓDIGO DE BARRAS
app.get('/api/Productos/buscar/:codigo', async (req, res) => {
    try {
        const { codigo } = req.params;
        const result = await pool.query('SELECT * FROM productos WHERE codigo_barras = $1', [codigo]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: Crear un producto nuevo
app.post('/api/Productos', verificarToken, async (req, res) => {
    try {
        // 1. Corregido: leemos req.user, igual que en el endpoint de categorías
        const id_negocio = req.user.id_negocio;

        const { categoriaId, nombre, precioCosto, precioVenta, stock, codigoBarras } = req.body;
        
        // 2. Validación básica
        if (!nombre || !precioVenta) {
            return res.status(400).json({ error: "El nombre y el precio de venta son obligatorios." });
        }

        // 3. Agregamos id_negocio a la query SQL
        const query = `
            INSERT INTO productos (id_negocio, id_categoria, nombre, costo, precio_venta, stock, codigo_barras)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *; 
        `;
        
        const values = [id_negocio, categoriaId, nombre, precioCosto, precioVenta, stock, codigoBarras];
        
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
        
    } catch (err) {
        console.error("Error al crear producto:", err);
        res.status(500).json({ error: "Error al crear el producto en el servidor." });
    }
});


app.post('/api/Categorias', verificarToken, async (req, res) => {
    try {
        const { nombre } = req.body;
        
        // 1. Sacamos el id_negocio del token
        const id_negocio = req.user.id_negocio;
        
        console.log(`👉 [POST /api/Categorias] Kiosco ID: ${id_negocio} | Creando categoría:`, nombre);

        if (!nombre) {
            console.log("❌ Error: El frontend no mandó el nombre");
            return res.status(400).json({ error: "El nombre es obligatorio" });
        }

        // 2. Agregamos el id_negocio al INSERT
        // OJO: Chequeá si tu tabla se llama "categoria" (singular) o "categorias" (plural). 
        // Yo le puse "categorias" que suele ser el estándar, pero ajustalo a tu DB.
        const result = await pool.query(
            'INSERT INTO categorias (id_negocio, nombre_categoria) VALUES ($1, $2) RETURNING *',
            [id_negocio, nombre]
        );
        
        console.log("✅ Categoría creada en DB:", result.rows[0]);
        res.status(201).json(result.rows[0]);

    } catch (err) {
        console.error("❌ Error fatal en BD al crear categoría:", err.message);
        res.status(500).json({ error: "Error interno al crear la categoría." });
    }
});

// POST: Login de usuario
app.post('/api/Auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Búsqueda directa en una sola tabla, rapidísimo
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        const usuario = result.rows[0];

        // Comparamos contraseña
        const validPassword = await bcrypt.compare(password, usuario.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        // Armamos el token
        const token = jwt.sign(
            { 
                id_usuario: usuario.id_usuario, 
                id_negocio: usuario.id_negocio, 
                rol: usuario.rol, 
                nombre: usuario.nombre 
            },
            process.env.JWT_SECRET || 'secreto_kiosco_super_seguro',
            { expiresIn: '8h' }
        );

        res.json({
            success: true,
            token: token,
            rol: usuario.rol,
            user: {
                id: usuario.id_usuario,
                id_negocio: usuario.id_negocio,
                nombre: usuario.nombre,
                email: usuario.email
            }
        });

    } catch (err) {
        console.error("Error en login:", err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.get('/api/Categorias', verificarToken, async (req, res) => {
    try {
        // 1. Obtenemos el ID del negocio que está haciendo la consulta
        const id_negocio = req.user.id_negocio;

        // 2. Filtramos la tabla para que devuelva SOLO lo de este kiosco
        // (y corregimos el nombre de la tabla a "categorias")
        const result = await pool.query(
            'SELECT * FROM categorias WHERE id_negocio = $1',
            [id_negocio]
        );
        
        res.json(result.rows);
        
    } catch (err) {
        console.error("❌ Error al obtener categorías:", err.message);
        res.status(500).json({ error: "Error al obtener las categorías" });
    }
});

app.put('/api/Productos/:id', verificarToken, async (req, res) => {
    const { id } = req.params;
    
    // Agarramos lo que manda el action del frontend (viene en camelCase)
    const { nombre, codigoBarras, precioCosto, precioVenta, stock, categoriaId } = req.body;

    // Validación de seguridad básica en el backend
    if (!nombre || precioCosto === undefined || precioVenta === undefined || !categoriaId) {
        return res.status(400).json({ error: "Faltan datos obligatorios para actualizar." });
    }

    try {
        // Hacemos el UPDATE mapeando a los nombres reales de las columnas en Neon (snake_case)
        const query = `
            UPDATE productos 
            SET nombre = $1, 
                codigo_barras = $2, 
                costo = $3, 
                precio_venta = $4, 
                stock = $5, 
                id_categoria = $6
            WHERE id_producto = $7 
            RETURNING *;
        `;
        
        // El orden de los valores tiene que coincidir con los $1, $2, etc.
        const values = [nombre, codigoBarras, precioCosto, precioVenta, stock, categoriaId, id];
        
        const result = await pool.query(query, values);

        // Si no actualizó ninguna fila, es porque ese ID no existe
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "El producto que intentas editar no existe." });
        }

        // Todo 10 puntos, devolvemos success
        return res.status(200).json({ 
            success: true, 
            message: "Producto actualizado con éxito." 
        });

    } catch (error) {
        console.error("Error al actualizar producto:", error);
        return res.status(500).json({ error: "Error interno del servidor al actualizar." });
    }
});

app.delete('/api/Productos/:id', verificarToken, async (req, res) => {
    const { id } = req.params;

    try {
        // Ejecutamos el DELETE en Neon
        const query = 'DELETE FROM productos WHERE id_producto = $1 RETURNING *';
        const result = await pool.query(query, [id]);

        // Verificamos si realmente se borró algo
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "El producto no existe o ya fue eliminado." });
        }

        // Todo salió perfecto, respondemos ok
        return res.status(200).json({ 
            success: true, 
            message: "Producto eliminado correctamente." 
        });

    } catch (error) {
        console.error("Error al eliminar producto:", error);

        // Si el producto ya está en una tabla de "ventas", Postgres tira el error 23503
        if (error.code === '23503') { 
            return res.status(400).json({ 
                error: "No podés eliminar este producto porque ya tiene ventas registradas. Te sugerimos poner su stock en 0." 
            });
        }

        return res.status(500).json({ error: "Error interno del servidor al eliminar." });
    }
});

app.post('/api/usuarios/registro', async (req, res) => {
    const { nombre_local, nombre, apellido, email, telefono, password, rol } = req.body;

    // 1. Validamos que lleguen todos los datos
    if (!nombre_local || !nombre || !apellido || !email || !telefono || !password) {
        return res.status(400).json({ error: "Faltan campos obligatorios para el registro." });
    }

    // 2. Pedimos un cliente para iniciar la TRANSACCIÓN
    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Arrancamos la transacción

        // 3. Verificamos que el email no exista ya (AHORA BUSCA DIRECTO EN LA TABLA USUARIOS)
        const emailCheck = await client.query('SELECT id_usuario FROM usuarios WHERE email = $1', [email]);
        if (emailCheck.rows.length > 0) {
            await client.query('ROLLBACK'); // Cancelamos todo
            return res.status(400).json({ error: "Este email ya está registrado en el sistema." });
        }

        // 4. Encriptamos la contraseña
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 5. Insertamos el NEGOCIO
        const queryNegocio = `INSERT INTO negocios (nombre) VALUES ($1) RETURNING id_negocio`;
        const resNegocio = await client.query(queryNegocio, [nombre_local]);
        const id_negocio = resNegocio.rows[0].id_negocio;

        // 6. Insertamos el USUARIO (Con el email y telefono en la misma tabla)
        const nombre_completo = `${nombre} ${apellido}`;
        const queryUsuario = `
            INSERT INTO usuarios (id_negocio, nombre, apellido, nombre_completo, rol, password, email, telefono) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        
        await client.query(queryUsuario, [
            id_negocio, nombre, apellido, nombre_completo, rol || 'administrador', hashedPassword, email, telefono
        ]);

        // 7. Si todo salió perfecto, GUARDAMOS LOS CAMBIOS
        await client.query('COMMIT');

        return res.status(201).json({ 
            success: true, 
            message: "Kiosco y cuenta de administrador creados exitosamente." 
        });

    } catch (error) {
        // Si CUALQUIER consulta falla, se revierte TODA la operación
        await client.query('ROLLBACK');
        console.error("Error al registrar el kiosco:", error);
        return res.status(500).json({ error: "Error interno del servidor al crear la cuenta." });
    } finally {
        // Devolvemos el cliente al pool
        client.release();
    }
});

app.post('/api/usuarios/empleado', verificarToken, async (req, res) => {
    try {
        // 1. Extraemos el id_negocio del token (el que está creando al empleado)
        const id_negocio = req.user.id_negocio;

        // (Opcional pero recomendado) Verificamos que el que hace la petición sea administrador
        if (req.user.rol !== 'administrador') {
            return res.status(403).json({ error: "Solo los administradores pueden crear empleados." });
        }

        const { nombre, apellido, email, password, rol } = req.body;

        // 2. Validación básica
        if (!nombre || !apellido || !email || !password || !rol) {
            return res.status(400).json({ error: "Faltan datos obligatorios." });
        }

        // 3. Verificamos que el email no esté usado por otro usuario en toda la plataforma
        const emailCheck = await pool.query('SELECT id_usuario FROM usuarios WHERE email = $1', [email]);
        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ error: "Este email ya está registrado." });
        }

        // 4. Encriptamos la contraseña del empleado
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const nombre_completo = `${nombre} ${apellido}`;

        // 5. Insertamos al empleado ATADO al id_negocio del administrador
        const query = `
            INSERT INTO usuarios (id_negocio, nombre, apellido, nombre_completo, rol, password, email) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id_usuario, nombre, email, rol
        `;
        
        const values = [id_negocio, nombre, apellido, nombre_completo, rol, hashedPassword, email];
        
        const result = await pool.query(query, values);
        
        res.status(201).json({
            success: true,
            usuario: result.rows[0],
            message: "Empleado creado exitosamente"
        });

    } catch (err) {
        console.error("❌ Error al crear empleado:", err);
        res.status(500).json({ error: "Error interno del servidor al crear el empleado." });
    }
});

app.post('/api/Pagos', verificarToken, async (req, res) => {
    // Pedimos una conexión exclusiva para hacer la transacción segura
    const client = await pool.connect();

    try {
        // 1. Extraemos los datos del token (usando tu formato req.user)
        const id_negocio = req.user.id_negocio;
        const id_usuario = req.user.id_usuario; // Asumo que el ID del cajero lo guardás así

        const { cart, total, tipo_medio } = req.body;

        // 2. Validaciones básicas
        if (!cart || cart.length === 0) {
            return res.status(400).json({ error: "El carrito está vacío." });
        }
        if (!total || !tipo_medio) {
            return res.status(400).json({ error: "Faltan datos del pago." });
        }

        // 🚀 INICIA LA TRANSACCIÓN SQL
        await client.query('BEGIN'); 

        // 3. Verificamos que el cajero tenga su caja abierta
        const cajaCheck = await client.query(
            `SELECT id_caja FROM cajas_diarias 
             WHERE id_usuario = $1 AND id_negocio = $2 AND estado = 'abierta'`,
            [id_usuario, id_negocio]
        );

        if (cajaCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Tenés que abrir la caja antes de cobrar." });
        }
        const id_caja = cajaCheck.rows[0].id_caja;

        // 4. Creamos el ticket general (Tabla Pagos)
        const pagoQuery = `
            INSERT INTO pagos (id_negocio, id_caja, monto, tipo_medio)
            VALUES ($1, $2, $3, $4)
            RETURNING id_pago
        `;
        const pagoResult = await client.query(pagoQuery, [id_negocio, id_caja, total, tipo_medio]);
        const id_pago = pagoResult.rows[0].id_pago;

        // 5. Guardamos el detalle y descontamos stock (Iterando el carrito)
        for (let item of cart) {
            
            // a) Guardamos el renglón con el precio congelado
            await client.query(
                `INSERT INTO detalle_ventas (id_pago, id_producto, cantidad_producto, precio_unitario)
                 VALUES ($1, $2, $3, $4)`,
                [id_pago, item.id_producto, item.cantidad, item.precio]
            );

            // b) Restamos el stock validando el id_negocio para mayor seguridad
            await client.query(
                `UPDATE productos 
                 SET stock = stock - $1 
                 WHERE id_producto = $2 AND id_negocio = $3`,
                [item.cantidad, item.id_producto, id_negocio]
            );
        }

        // 🎉 Todo salió bien, guardamos los cambios definitivamente
        await client.query('COMMIT'); 

        res.status(201).json({ 
            success: true, 
            message: "Cobro realizado con éxito", 
            id_pago: id_pago 
        });

    } catch (err) {
        // ❌ Si cualquier cosa falla (ej: falta de stock, error de red), deshacemos todo
        await client.query('ROLLBACK'); 
        console.error("❌ Error al procesar el pago:", err);
        res.status(500).json({ error: "Error interno del servidor al procesar la venta." });
    } finally {
        // Siempre liberamos la conexión al pool
        client.release(); 
    }
});

// 5. Iniciar el servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend conectado y corriendo en el puerto ${PORT}`);
});