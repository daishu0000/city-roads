@echo off
rmdir /s /q dist
npm run build
cd dist
git init
git add .
git commit -m "push to gh-pages"
git push --force git@github.com:daishu0000/city-roads.git main:gh-pages
cd ..
for /f "tokens=1-4 delims=/- " %%a in ('echo %date% %time%') do set TAG=release-%%a%%b%%c%%d
git tag %TAG%
git push --tags