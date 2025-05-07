FROM nginx:alpine

# 1) Unpack draw.io
COPY drawio-26.2.15.zip /drawio-web.zip
RUN apk add --no-cache unzip \
 && unzip /drawio-web.zip -d /tmp/drawio \
 && mv /tmp/drawio/drawio-26.2.15/src/main/webapp/* /usr/share/nginx/html/ \
 && rm -rf /tmp/drawio /drawio-web.zip

# 2) Copy your bridge script
COPY mcp-bridge.js /usr/share/nginx/html/js/mcp-bridge.js

# 3) Relax CSP to allow ws: and inline scripts
RUN sed -i 's|<meta http-equiv="Content-Security-Policy".*|<meta http-equiv="Content-Security-Policy" content="default-src '\''self'\'' ws: data: blob:; connect-src '\''self'\'' ws:; script-src '\''self'\'' '\''unsafe-inline'\''; style-src '\''self'\'' '\''unsafe-inline'\'';">|' /usr/share/nginx/html/index.html

# 4) Inject the MCP bridge <script> just before the geMain inline script
RUN sed -i '/<script id="geMain"/i <script src="js/mcp-bridge.js"></script>' /usr/share/nginx/html/index.html

# 5) Simple nginx config
RUN rm /etc/nginx/conf.d/default.conf \
 && printf 'server {\n\
    listen 80;\n\
    location / {\n\
      root /usr/share/nginx/html;\n\
      index index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/drawio.conf
