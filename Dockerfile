FROM node:20-alpine

# Définit le répertoire de travail dans le conteneur
WORKDIR /app

# Copie les fichiers de dépendances en premier pour profiter du cache Docker
COPY package*.json ./

# Installe les dépendances
RUN npm install

# Copie le reste du code source de l'application
COPY . .

# Expose le port de l'API Express
EXPOSE 3000

# Démarre l'API en mode développement (rechargement automatique avec --watch)
CMD ["npm", "run", "dev"]

