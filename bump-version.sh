#!/bin/sh
# Run before committing a change to CSS/JS: updates the ?v= tags in index.html so browsers
# fetch the new files instead of using a cached copy.
V=$(date +%Y%m%d%H%M)
sed -i -E "s#(href=\"styles\.css)(\?v=[0-9]+)?\"#\1?v=$V\"#; s#(src=\"(config|carpathia|unitcard|modulepdf|wall|app)\.js)(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html
echo "Asset version set to $V"
