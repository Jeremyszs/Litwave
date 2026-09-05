#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <complex>
#include <cstdint>

class StageWarmth {
public:
    explicit StageWarmth(float sampleRate = 44100.0f)
        : sampleRate_(sampleRate), enabled_(true), drive_(1.2f), targetDrive_(1.2f), currentDrive_(1.2f),
          mode_(0), currentSaturation_(0.0f), smoothSaturation_(0.0f) {
        setSampleRate(sampleRate);
    }

    void setSampleRate(float sr) {
        sampleRate_ = std::max(8000.0f, sr);
        smoothCoeff_ = 1.0f - std::exp(-1.0f / (sampleRate_ * 0.020f));
    }

    void setEnabled(bool en) { enabled_ = en; }
    bool isEnabled() const { return enabled_; }

    void setDrive(float drive) { targetDrive_ = std::max(1.0f, std::min(3.0f, drive)); }
    float drive() const { return targetDrive_; }

    void setMode(int mode) { mode_ = (mode == 1) ? 1 : 0; }
    int mode() const { return mode_; }

    inline void process(float& l, float& r) {
        if (!std::isfinite(l)) l = 0.0f;
        if (!std::isfinite(r)) r = 0.0f;

        if (!enabled_) {
            smoothSaturation_ *= 0.90f;
            return;
        }

        currentDrive_ += (targetDrive_ - currentDrive_) * smoothCoeff_;

        const float inL = l * currentDrive_;
        const float inR = r * currentDrive_;

        // Analog soft-saturation curve: tanh with musical harmonic rounding
        float outL = std::tanh(inL);
        float outR = std::tanh(inR);

        if (mode_ == 0) { // Tape Warmth: gentle even-harmonic richness
            outL = (outL + 0.08f * (outL * outL)) / 1.08f;
            outR = (outR + 0.08f * (outR * outR)) / 1.08f;
        }

        // Automatic gain compensation so drive adds density without extreme volume jump
        const float norm = 1.0f / std::tanh(currentDrive_);
        outL *= norm;
        outR *= norm;

        const float satAmount = std::max(std::fabs(outL - l), std::fabs(outR - r));
        if (satAmount > currentSaturation_) currentSaturation_ = satAmount;

        l = outL;
        r = outR;
    }

    void endBlock() {
        smoothSaturation_ = std::max(currentSaturation_, smoothSaturation_ * 0.88f);
        currentSaturation_ = 0.0f;
    }

    float saturationMeter() const { return smoothSaturation_; }

private:
    float sampleRate_;
    bool enabled_;
    float drive_, targetDrive_, currentDrive_;
    int mode_;
    float smoothCoeff_;
    float currentSaturation_, smoothSaturation_;
};

class SpectrumCapture {
public:
    static const int FFT_SIZE = 4096;
    static const int OUTPUT_BINS = 96;

    explicit SpectrumCapture(float sampleRate = 44100.0f)
        : sampleRate_(sampleRate), writeBuffer_(0), writePos_(0), publishedBuffer_(-1), readerBuffer_(-1) {
        for (int b = 0; b < 3; ++b) for (int i = 0; i < FFT_SIZE; ++i) buffers_[b][i] = 0.0f;
        for (int i = 0; i < OUTPUT_BINS; ++i) smoothed_[i] = -90.0f;
    }

    void setSampleRate(float sampleRate) { sampleRate_ = std::max(8000.0f, sampleRate); }

    inline void push(float mono) {
        buffers_[writeBuffer_][writePos_++] = std::isfinite(mono) ? mono : 0.0f;
        if (writePos_ == FFT_SIZE) {
            publishedBuffer_.store(writeBuffer_, std::memory_order_release);
            const int reader = readerBuffer_.load(std::memory_order_acquire);
            for (int candidate = 0; candidate < 3; ++candidate) {
                if (candidate != writeBuffer_ && candidate != reader) {
                    writeBuffer_ = candidate;
                    break;
                }
            }
            writePos_ = 0;
        }
    }

    void computeLogBins(float* output) {
        const int published = publishedBuffer_.load(std::memory_order_acquire);
        if (published < 0) {
            for (int i = 0; i < OUTPUT_BINS; ++i) output[i] = -90.0f;
            return;
        }
        readerBuffer_.store(published, std::memory_order_release);
        float windowSum = 0.0f;
        for (int i = 0; i < FFT_SIZE; ++i) {
            const float window = 0.5f - 0.5f * std::cos(2.0f * 3.14159265358979323846f * i / (FFT_SIZE - 1));
            real_[i] = buffers_[published][i] * window;
            imag_[i] = 0.0f;
            windowSum += window;
        }
        fft();
        for (int i = 0; i < OUTPUT_BINS; ++i) {
            const float t = static_cast<float>(i) / static_cast<float>(OUTPUT_BINS - 1);
            const float frequency = 20.0f * std::pow(1000.0f, t);
            const float fftIndex = frequency * FFT_SIZE / sampleRate_;
            int center = std::max(1, std::min(FFT_SIZE / 2 - 1, static_cast<int>(fftIndex + 0.5f)));
            const int radius = std::max(1, center / 45);
            float magnitude = 0.0f;
            for (int k = std::max(1, center - radius); k <= std::min(FFT_SIZE / 2 - 1, center + radius); ++k) {
                magnitude = std::max(magnitude, std::sqrt(real_[k] * real_[k] + imag_[k] * imag_[k]));
            }
            const float db = std::max(-90.0f, std::min(0.0f, 20.0f * std::log10(std::max(2.0f * magnitude / windowSum, 1e-9f))));
            const float alpha = db > smoothed_[i] ? 0.55f : 0.18f;
            smoothed_[i] += alpha * (db - smoothed_[i]);
            output[i] = smoothed_[i];
        }
        readerBuffer_.store(-1, std::memory_order_release);
    }

private:
    void fft() {
        for (int i = 1, j = 0; i < FFT_SIZE; ++i) {
            int bit = FFT_SIZE >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                std::swap(real_[i], real_[j]);
                std::swap(imag_[i], imag_[j]);
            }
        }
        for (int len = 2; len <= FFT_SIZE; len <<= 1) {
            const float angle = -2.0f * 3.14159265358979323846f / len;
            const float wLenR = std::cos(angle), wLenI = std::sin(angle);
            for (int i = 0; i < FFT_SIZE; i += len) {
                float wr = 1.0f, wi = 0.0f;
                for (int j = 0; j < len / 2; ++j) {
                    const int a = i + j, b = a + len / 2;
                    const float vr = real_[b] * wr - imag_[b] * wi;
                    const float vi = real_[b] * wi + imag_[b] * wr;
                    const float ur = real_[a], ui = imag_[a];
                    real_[a] = ur + vr; imag_[a] = ui + vi;
                    real_[b] = ur - vr; imag_[b] = ui - vi;
                    const float nextWr = wr * wLenR - wi * wLenI;
                    wi = wr * wLenI + wi * wLenR;
                    wr = nextWr;
                }
            }
        }
    }

    float sampleRate_;
    float buffers_[3][FFT_SIZE];
    float real_[FFT_SIZE], imag_[FFT_SIZE], smoothed_[OUTPUT_BINS];
    int writeBuffer_, writePos_;
    std::atomic<int> publishedBuffer_, readerBuffer_;
};

class CallbackPerformanceMonitor {
public:
    CallbackPerformanceMonitor()
        : smoothed_(0.0f), peak_(0.0f), xruns_(0), warmupRemaining_(6) {}

    void update(double processingSeconds, double callbackGapSeconds, double budgetSeconds, uint32_t periods = 2) {
        if (budgetSeconds <= 0.0) return;
        if (warmupRemaining_ > 0) {
            --warmupRemaining_;
            return;
        }
        const float load = static_cast<float>(processingSeconds / budgetSeconds);
        smoothed_ += 0.10f * (load - smoothed_);
        // Peak decay (~2.5% decay per callback) so it tracks current peak workload rather than holding startup spikes forever
        peak_ = std::max(load, peak_ * 0.975f);

        // A true XRUN occurs when callback processing time misses the audio frame deadline,
        // or if the inter-callback arrival interval exceeds the entire multi-period hardware ring buffer.
        const double bufferExhaustionThreshold = budgetSeconds * std::max(2u, periods) * 1.25;
        if (processingSeconds > budgetSeconds || callbackGapSeconds > bufferExhaustionThreshold) {
            ++xruns_;
        }
    }

    float smoothedLoad() const { return smoothed_; }
    float peakLoad() const { return peak_; }
    uint32_t xruns() const { return xruns_; }

private:
    float smoothed_;
    float peak_;
    uint32_t xruns_;
    int warmupRemaining_;
};
