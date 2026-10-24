import numpy as np
from scipy.signal import savgol_filter
from sklearn.preprocessing import FunctionTransformer
from sklearn.pipeline import make_pipeline


def snv(X):
    X = np.asarray(X, dtype=float)
    return (X - X.mean(axis=1, keepdims=True)) / X.std(axis=1, keepdims=True)


def savgol(X):
    return savgol_filter(np.asarray(X, dtype=float), window_length=15, polyorder=2, deriv=1, axis=1)


def preprocessor():
    return make_pipeline(FunctionTransformer(snv), FunctionTransformer(savgol))
