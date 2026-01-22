const { createClient } = require('@supabase/supabase-js')

// Diese Funktion läuft auf dem SERVER (nicht im Browser)
// Deshalb ist der SERVICE_ROLE Key hier sicher!

exports.handler = async (event, context) => {
  // Nur POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  try {
    const { email, password, name, program, adminEmail } = JSON.parse(event.body)

    // Validierung
    if (!email || !password || !name || !program || !adminEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      }
    }

    // Supabase Admin Client (mit SERVICE_ROLE Key)
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error' })
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Prüfe: Ist der Request von einem Admin?
    const { data: adminCheck, error: adminError } = await supabase
      .from('admin_users')
      .select('email')
      .eq('email', adminEmail)
      .single()

    if (adminError || !adminCheck) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Unauthorized: Not an admin' })
      }
    }

    // 1. User in Supabase Auth anlegen (mit Passwort, OHNE Email!)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true, // ← WICHTIG: Bestätigt sofort, keine Email!
      user_metadata: {
        name: name
      }
    })

    if (authError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: authError.message })
      }
    }

    // 2. Customer in customers Tabelle anlegen
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .insert({
        email: email,
        name: name,
        program: program,
        active: true,
        auth_user_id: authData.user.id
      })
      .select()
      .single()

    if (customerError) {
      // Rollback: Lösche Auth User wenn Customer-Insert fehlschlägt
      await supabase.auth.admin.deleteUser(authData.user.id)
      
      return {
        statusCode: 400,
        body: JSON.stringify({ error: customerError.message })
      }
    }

    // Erfolg!
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        customer: customerData,
        message: 'Customer created successfully'
      })
    }

  } catch (error) {
    console.error('Error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    }
  }
}
