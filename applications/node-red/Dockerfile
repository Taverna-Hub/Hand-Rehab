FROM nodered/node-red:3.1.15-18

ENV FLOWS=flows.json

COPY package.json /data/package.json
RUN cd /data && npm install --unsafe-perm --no-update-notifier --no-fund --omit=dev

COPY flows.json /data/flows.json

EXPOSE 1880 1883
