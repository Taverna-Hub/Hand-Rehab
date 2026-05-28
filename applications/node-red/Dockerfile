FROM nodered/node-red:3.1.15-18

WORKDIR /data

# Flow de ingestao de dados da ESP32.
ENV FLOWS=flows.json

COPY hand-rehab-flow.json /data/flows.json

# Broker MQTT via Aedes dentro do Node-RED.
RUN npm install --unsafe-perm --no-update-notifier --no-fund node-red-contrib-aedes

EXPOSE 1880 1883
