head(){ cat <<'H'
<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="theme-color" content="#f6f3ed"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet"><link rel="stylesheet" href="style.css">
H
}
nav(){ cat <<'N'
<nav class="nav"><a class="brand" href="index.html">Carina Anna Prav</a><div class="nav-links"><a href="about.html">About</a><a href="mentoring.html">Mentoring</a><a href="blog.html">Journal</a><a class="pill" href="mentoring-bewerbung.html">Bewerben</a></div></nav>
N
}
foot(){ cat <<'F'
<footer class="footer"><div>Carina Anna Prav · Personal Brand & Angebotscoaching</div><div><a href="impressum.html">Impressum</a><a href="datenschutz.html">Datenschutz</a><a href="agb.html">AGB</a></div></footer></body></html>
F
}
