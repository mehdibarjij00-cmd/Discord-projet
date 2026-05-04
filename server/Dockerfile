FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# On installe TOUTES les dépendances (y compris Nodemon)
RUN npm install

COPY . .

RUN mkdir -p /app/data/uploads

EXPOSE 3001

# On utilise notre script qui ignore les fichiers JSON
CMD ["npm", "run", "dev"]