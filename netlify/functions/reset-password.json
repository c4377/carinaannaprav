const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    // CORS Headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { email, newPassword, adminEmail } = JSON.parse(event.body);

        // Validate input
        if (!email || !newPassword || !adminEmail) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Email, newPassword und adminEmail erforderlich' })
            };
        }

        if (newPassword.length < 8) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Passwort muss mindestens 8 Zeichen haben' })
            };
        }

        // Create Supabase Admin Client
        const supabaseAdmin = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );

        // Verify admin
        const { data: adminCheck } = await supabaseAdmin
            .from('admin_users')
            .select('email')
            .eq('email', adminEmail)
            .single();

        if (!adminCheck) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Nicht autorisiert' })
            };
        }

        // Find user by email
        const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        
        if (listError) {
            console.error('List users error:', listError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Fehler beim Suchen des Users' })
            };
        }

        const user = users.find(u => u.email === email);
        
        if (!user) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'User nicht gefunden' })
            };
        }

        // Update password
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
            user.id,
            { password: newPassword }
        );

        if (updateError) {
            console.error('Update password error:', updateError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Fehler beim Passwort-Update: ' + updateError.message })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Passwort erfolgreich geändert'
            })
        };

    } catch (error) {
        console.error('Reset password error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Server-Fehler: ' + error.message })
        };
    }
};
