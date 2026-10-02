FROM node:20-slim

# Install yt-dlp, ffmpeg, and deno (required for YouTube extraction)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    unzip \
    && pip3 install --break-system-packages "yt-dlp[default]" \
    && curl -fsSL https://deno.land/install.sh | sh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Add deno to PATH
ENV DENO_INSTALL="/root/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source
COPY . .

# Create temp directory
RUN mkdir -p /tmp/audio

# Expose port
EXPOSE 3001

# Start server. Update yt-dlp on every boot so a simple redeploy/restart always
# pulls the latest extractor AND its compatible yt-dlp-ejs challenge solver.
# Deno alone is insufficient; bare `pip install yt-dlp` omits the solver.
CMD sh -c 'pip3 install --break-system-packages -U "yt-dlp[default]" || true; exec node server.js'
