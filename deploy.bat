@echo off
rmdir /s /q dist
call npm run build
cd dist
git init
git add .
git commit -m "push to gh-pages"
git push --force https://github.com/daishu0000/city-roads.git master:gh-pages