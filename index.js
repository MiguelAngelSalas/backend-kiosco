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
        // 1. Extraemos los datos del token
        const id_negocio = req.user.id_negocio;
        const id_usuario = req.user.id_usuario; // Ya no lo usamos para bloquear la caja

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

        // 👇 3. EL CAMBIO CLAVE: Verificamos que haya ALGUNA caja abierta en el local
        const cajaCheck = await client.query(
            `SELECT id_caja FROM cajas_diarias 
             WHERE id_negocio = $1 AND estado = 'abierta'`,
            [id_negocio]
        );

        if (cajaCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "No hay ninguna caja abierta en el local para registrar la venta." });
        }
        const id_caja = cajaCheck.rows[0].id_caja;

        // 4. Creamos el ticket general (Tabla Pagos)
        const pagoQuery = `
            INSERT INTO pagos (id_negocio, id_caja,id_usuario, monto, tipo_medio)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id_pago
        `;
        const pagoResult = await client.query(pagoQuery, [id_negocio, id_caja, id_usuario, total, tipo_medio]);
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

app.post('/api/Cajas/abrir', verificarToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const { monto_inicial } = req.body;
        const id_negocio = req.user.id_negocio;
        const id_usuario = req.user.id_usuario; // Guardamos quién la abrió para el ticket

        // 🛑 1. VALIDACIÓN CLAVE: ¿Ya hay una caja abierta en este negocio?
        const checkResult = await client.query(
            `SELECT id_caja FROM cajas_diarias 
             WHERE id_negocio = $1 AND estado = 'abierta'`,
            [id_negocio]
        );

        if (checkResult.rows.length > 0) {
            // Si ya hay una, bloqueamos la creación
            return res.status(400).json({ 
                error: "Ya existe una caja abierta en el local. Cerrala antes de abrir otra." 
            });
        }

        // ✅ 2. Si no hay ninguna abierta, la creamos tranquilos
        const insertResult = await client.query(
            `INSERT INTO cajas_diarias (id_negocio, id_usuario, monto_inicial, estado)
             VALUES ($1, $2, $3, 'abierta') 
             RETURNING id_caja`,
            [id_negocio, id_usuario, monto_inicial]
        );

        res.status(200).json({ 
            success: true, 
            id_caja: insertResult.rows[0].id_caja,
            message: "Caja abierta correctamente."
        });

    } catch (err) {
        console.error("❌ Error al abrir caja:", err);
        res.status(500).json({ error: "Error interno al intentar abrir la caja." });
    } finally {
        client.release();
    }
});

app.get('/api/Cajas/estado', verificarToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const id_negocio = req.user.id_negocio;
        // Ya no necesitamos el id_usuario acá

        // 👇 Le sacamos el id_usuario al WHERE y dejamos solo id_negocio
        const result = await client.query(
            `SELECT id_caja, monto_inicial, fecha_apertura 
             FROM cajas_diarias 
             WHERE id_negocio = $1 AND estado = 'abierta'`,
            [id_negocio]
        );

        if (result.rows.length > 0) {
            // Si encontró una en el LOCAL, devolvemos abierta: true
            return res.status(200).json({ abierta: true, caja: result.rows[0] });
        } else {
            // Si no encontró ninguna en todo el local
            return res.status(200).json({ abierta: false });
        }
    } catch (err) {
        console.error("❌ Error al verificar caja:", err);
        res.status(500).json({ error: "Error al verificar el estado de la caja." });
    } finally {
        client.release();
    }
});

app.get('/api/Cajas/resumen', verificarToken, async (req, res) => {
    // Usamos tu pool de PostgreSQL
    const client = await pool.connect();
    try {
        const id_negocio = req.user.id_negocio;
        // 👇 Ya no hace falta el id_usuario para bloquear

        // Paso 1: Buscamos la caja abierta de este NEGOCIO (sin importar el usuario)
        const cajaResult = await client.query(
            `SELECT id_caja, monto_inicial FROM cajas_diarias 
             WHERE id_negocio = $1 AND estado = 'abierta'`,
            [id_negocio]
        );

        if (cajaResult.rows.length === 0) {
            return res.status(404).json({ error: "No hay ninguna caja abierta en el local." });
        }

        const id_caja = cajaResult.rows[0].id_caja;
        const monto_inicial = parseFloat(cajaResult.rows[0].monto_inicial);

        // Paso 2: Sumamos todas las ventas de esta caja, agrupadas por método de pago
        const ventasResult = await client.query(
            `SELECT tipo_medio, SUM(monto) as total_vendido 
             FROM pagos 
             WHERE id_caja = $1 
             GROUP BY tipo_medio`,
            [id_caja]
        );

        let total_ventas = 0;
        let total_efectivo = 0;
        let total_digital = 0;
        const desglose = {};

        // Paso 3: Acomodamos los números
        ventasResult.rows.forEach(fila => {
            const monto = parseFloat(fila.total_vendido);
            total_ventas += monto;
            desglose[fila.tipo_medio] = monto;
            
            // Si en tu frontend manda "efectivo", lo sumamos a la plata física
            if (fila.tipo_medio === 'efectivo' || fila.tipo_medio === 'Efectivo') {
                total_efectivo += monto;
            } else {
                total_digital += monto;
            }
        });

        // La plata física que tiene que haber en el cajón (cambio inicial + ventas en efectivo)
        const dinero_en_cajon = monto_inicial + total_efectivo;

        res.status(200).json({
            success: true,
            resumen: {
                monto_inicial,
                total_ventas,
                total_efectivo,
                total_digital,
                dinero_en_cajon,
                desglose
            }
        });

    } catch (err) {
        console.error("❌ Error al obtener resumen:", err);
        res.status(500).json({ error: "Error al calcular el resumen de la caja." });
    } finally {
        client.release();
    }
});

app.put('/api/Cajas/cerrar', verificarToken, async (req, res) => {
    const client = await pool.connect();
    try {
        // Sacamos los datos del usuario logueado gracias a tu middleware verificarToken
        const id_negocio = req.user.id_negocio;
        const id_usuario = req.user.id_usuario;

        // Actualizamos la caja a 'cerrada' y le metemos el timestamp actual de PostgreSQL
        const result = await client.query(
            `UPDATE cajas_diarias 
             SET estado = 'cerrada', fecha_cierre = CURRENT_TIMESTAMP
             WHERE id_usuario = $1 AND id_negocio = $2 AND estado = 'abierta'
             RETURNING id_caja`,
            [id_usuario, id_negocio]
        );
        console.log(result)
        // Si rowCount es 0, significa que no encontró ninguna caja abierta para ese usuario
        if (result.rowCount === 0) {
            return res.status(400).json({ error: "No se encontró una caja abierta para cerrar." });
        }

        // Todo salió perfecto
        res.status(200).json({ 
            success: true, 
            message: "Caja cerrada correctamente." 
        });

    } catch (err) {
        console.error("❌ Error al cerrar caja:", err);
        res.status(500).json({ error: "Error interno al cerrar la caja." });
    } finally {
        client.release();
    }
});

app.get('/api/Cajas/historial', verificarToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const id_negocio = req.user.id_negocio;

        // Traemos las últimas 50 cajas (ajustá el límite si querés más)
        const result = await client.query(
            `SELECT id_caja, monto_inicial, estado, fecha_cierre 
             FROM cajas_diarias 
             WHERE id_negocio = $1 
             ORDER BY id_caja DESC 
             LIMIT 50`,
            [id_negocio]
        );

        res.status(200).json({ success: true, cajas: result.rows });
    } catch (err) {
        console.error("❌ ERROR REAL DE POSTGRES EN HISTORIAL:", err.message);
        res.status(500).json({ error: "Error al cargar el historial de cajas." });
    } finally {
        client.release();
    }
});

app.get('/api/Cajas/resumen/:id_caja', verificarToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const id_negocio = req.user.id_negocio;
        const id_caja = req.params.id_caja;

        // 1. Buscamos la caja específica
        const cajaResult = await client.query(
            `SELECT c.*, u.nombre as nombre_usuario 
             FROM cajas_diarias c
             LEFT JOIN usuarios u ON c.id_usuario = u.id_usuario
             WHERE c.id_caja = $1 AND c.id_negocio = $2`,
            [id_caja, id_negocio]
        );

        if (cajaResult.rows.length === 0) {
            return res.status(404).json({ error: "Caja no encontrada." });
        }

        const caja = cajaResult.rows[0];
        const monto_inicial = parseFloat(caja.monto_inicial);

        // 2. Calculamos las ventas de ESA caja específica
        const ventasResult = await client.query(
            `SELECT tipo_medio, SUM(monto) as total_vendido 
             FROM pagos WHERE id_caja = $1 GROUP BY tipo_medio`,
            [id_caja]
        );

        let total_ventas = 0;
        let total_efectivo = 0;
        let desglose = {};

        ventasResult.rows.forEach(fila => {
            const monto = parseFloat(fila.total_vendido);
            total_ventas += monto;
            desglose[fila.tipo_medio] = monto;
            if (fila.tipo_medio === 'efectivo' || fila.tipo_medio === 'Efectivo') {
                total_efectivo += monto;
            }
        });

        res.status(200).json({
            success: true,
            resumen: {
                ...caja, // Mandamos los datos de la caja (fechas, etc)
                total_ventas,
                total_efectivo,
                dinero_en_cajon: monto_inicial + total_efectivo,
                desglose
            }
        });

    } catch (err) {
        console.error("❌ Error al obtener resumen específico:", err);
        res.status(500).json({ error: "Error al calcular la caja." });
    } finally {
        client.release();
    }
});

app.get('/api/Cajas/:id_caja/ventas', verificarToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const id_caja = req.params.id_caja;

        // 👇 Hacemos JOIN con usuarios para traer el nombre
        const result = await client.query(
            `SELECT p.id_pago, p.monto, p.tipo_medio, p.hora, u.nombre as cajero
             FROM pagos p
             LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
             WHERE p.id_caja = $1 
             ORDER BY p.id_pago DESC`,
            [id_caja]
        );

        res.status(200).json({ success: true, ventas: result.rows });
    } catch (err) {
        console.error("❌ Error al obtener ventas de la caja:", err.message);
        res.status(500).json({ error: "Error al cargar el detalle de ventas." });
    } finally {
        client.release();
    }
});
// 5. Iniciar el servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend conectado y corriendo en el puerto ${PORT}`);
});